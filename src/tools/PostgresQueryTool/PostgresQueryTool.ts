import { spawnSync } from 'child_process'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, POSTGRES_QUERY_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    connection: z.string().optional().describe('PostgreSQL connection string'),
    query: z.string().describe('SQL query'),
    timeout: z.number().optional().default(30).describe('Query timeout in seconds'),
    format: z.enum(['table', 'csv']).optional().default('table').describe('Output format'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    rows: z.array(z.record(z.unknown())).optional(),
    rowCount: z.number().optional(),
    columns: z.array(z.string()).optional(),
    error: z.string().optional(),
    durationMs: z.number(),
    truncated: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_RESULT_ROWS = 500
const MAX_RESULT_CHARS = 50_000

// Heuristic: only pure SELECT (no WITH/CTE) is safely read-only.
// WITH can contain data-modifying CTEs (DELETE/UPDATE/INSERT).
function isReadOnlyQuery(q: string): boolean {
  const t = q.trim().toLowerCase()
  if (t.startsWith('with')) return false // CTEs can contain DML
  return t.startsWith('select') || false
}

function isDestructiveQuery(q: string): boolean {
  const t = q.trim().toLowerCase()
  return t.startsWith('drop') || t.startsWith('truncate') || t.startsWith('delete') || (t.startsWith('alter') && t.includes('drop'))
}

function parseAligned(stdout: string): { rows: Record<string, unknown>[]; columns: string[] } {
  const lines = stdout.trim().split('\n').filter(l => l.trim())
  if (lines.length < 3) return { rows: [], columns: [] }
  const sep = lines[1]
  if (!sep || (!sep.includes('+') && !sep.includes('-'))) return { rows: [], columns: [] }
  const hasPipes = lines[0].includes('|')
  if (!hasPipes) {
    // Single-column output: no pipe separators
    // header: " count", separator: "-------", data: " 42"
    const header = lines[0].trim()
    const dataLines = lines.slice(2).filter(l => l.trim() && !l.includes('---'))
    const rows = dataLines.map(line => {
      const val = line.trim()
      return { [header]: /^\d+(\.\d+)?$/.test(val) ? (val.includes('.') ? parseFloat(val) : parseInt(val, 10)) : val }
    })
    return { rows, columns: [header] }
  }
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean)
  const data = lines.slice(2).filter(l => l.includes('|') && !l.includes('+') && !l.includes('---'))
  const rows = data.map(line => {
    const row: Record<string, unknown> = {}
    const vals = line.split('|').map(v => v.trim())
    headers.forEach((col, i) => { row[col] = /^\d+(\.\d+)?$/.test(vals[i] || '') ? (vals[i].includes('.') ? parseFloat(vals[i]) : parseInt(vals[i], 10)) : (vals[i] || '') })
    return row
  })
  return { rows, columns: headers }
}

function parseCsv(stdout: string): { rows: Record<string, unknown>[]; columns: string[] } {
  function splitCsvLine(line: string): string[] {
    const vals: string[] = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (inQ && i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
      else if (c === ',' && !inQ) { vals.push(cur.trim()); cur = '' }
      else cur += c
    }
    vals.push(cur.trim()); return vals
  }

  const lines = stdout.trim().split('\n').filter(l => l.trim())
  if (lines.length < 1) return { rows: [], columns: [] }
  const columns = splitCsvLine(lines[0])
  const rows = lines.slice(1).map(line => {
    const vals = splitCsvLine(line)
    const row: Record<string, unknown> = {}
    columns.forEach((col, i) => { row[col] = vals[i] || null })
    return row
  })
  return { rows, columns }
}

export const PostgresQueryTool = buildTool({
  name: POSTGRES_QUERY_TOOL_NAME,
  searchHint: 'execute SQL queries against PostgreSQL',
  maxResultSizeChars: MAX_RESULT_CHARS,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Postgres Query',
  isReadOnly(input) { return input ? isReadOnlyQuery(input.query) : false },
  isDestructive(input) { return input ? isDestructiveQuery(input.query) : false },
  toAutoClassifierInput(input) { return input.query.slice(0, 100) },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.query) return { result: false, message: 'Missing required parameter: query', errorCode: 1 }
    if (input.query.length > 10000) return { result: false, message: 'Query too long', errorCode: 1 }
    return { result: true }
  },
  async checkPermissions(input) {
    if (isDestructiveQuery(input.query)) return { behavior: 'ask', message: `Execute destructive query on PostgreSQL? ${input.query.slice(0, 200)}`, updatedInput: input }
    return { behavior: 'ask', message: `Execute PostgreSQL query? ${input.query.slice(0, 200)}`, updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return `Executing PostgreSQL query: ${input.query.slice(0, 200)}`
  },
  renderToolResultMessage(output) {
    if (!output.success) return `Query failed: ${output.error}`
    if (output.rows?.length) {
      const preview = output.truncated ? `Returned ${output.rowCount} rows (truncated, showing first ${output.rows.length})` : `Returned ${output.rowCount} rows`
      return `${preview} in ${output.durationMs}ms`
    }
    if (output.rowCount !== undefined) return `${output.rowCount} rows affected in ${output.durationMs}ms`
    return `Query executed in ${output.durationMs}ms`
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?) {
    const startTime = Date.now()
    // Connection priority: explicit string > PGDATABASE_URL > individual PG* env vars (libpq default)
    const connStr = input.connection || process.env.PGDATABASE_URL || ''
    const hasPgEnv = !connStr && (process.env.PGHOST || process.env.PGPORT || process.env.PGUSER || process.env.PGPASSWORD || process.env.PGDATABASE)
    if (!connStr && !hasPgEnv) return { data: { success: false, durationMs: Date.now() - startTime, error: 'No PostgreSQL connection configured. Provide a connection parameter or set PGDATABASE_URL / PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE.' } }

    try {
      const args: string[] = ['--no-psqlrc']
      if (input.format === 'csv') { args.push('--csv') } else { args.push('--aligned') }
      if (connStr) args.push('-c', input.query, connStr)
      else args.push('-c', input.query)

      // Preserve existing PGSSLMODE; only set PG* env vars that are user-configured
      const spawnEnv: Record<string, string> = { ...process.env as Record<string, string>, PGCONNECT_TIMEOUT: String(input.timeout ?? 30) }
      if (process.env.PGSSLMODE === undefined) delete spawnEnv.PGSSLMODE // don't force SSL

      const result = spawnSync('psql', args, { timeout: (input.timeout ?? 30) * 1000, maxBuffer: MAX_RESULT_CHARS, encoding: 'utf-8', env: spawnEnv })
      const stdout = (result.stdout ?? '').trim()
      const stderr = (result.stderr ?? '').trim()

      if ((result.status ?? 1) !== 0) return { data: { success: false, durationMs: Date.now() - startTime, error: (stdout + '\n' + stderr).trim().slice(0, 2000) || `psql exited with code ${result.status}` } }

      const { rows, columns } = input.format === 'csv' ? parseCsv(stdout) : parseAligned(stdout)
      const selectLike = /^\s*(select)\s/i.test(input.query.trim())
      const rowCount = selectLike ? rows.length : (() => { const m = stdout.match(/(INSERT \d+|UPDATE |DELETE )\s*(\d+)/); return m ? parseInt(m[2] || m[1].split(' ').pop() || '0', 10) : undefined })()

      const truncated = rows.length > MAX_RESULT_ROWS
      return { data: { success: true, rows: truncated ? rows.slice(0, MAX_RESULT_ROWS) : rows, rowCount: rowCount ?? rows.length, columns: columns.length > 0 ? columns : undefined, durationMs: Date.now() - startTime, truncated } }
    } catch (err) {
      return { data: { success: false, durationMs: Date.now() - startTime, error: err instanceof Error ? err.message.split('\n')[0] : String(err) } }
    }
  },
})

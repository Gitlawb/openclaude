import { spawnSync } from 'child_process'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, POSTGRES_QUERY_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    connection: z.string().optional().describe('PostgreSQL connection string (postgresql://user:pass@host:5432/db)'),
    query: z.string().describe('SQL query to execute'),
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
const SAFE_QUERY = /^[\s\w\d.,;()'"`=<>!+\-*/%&|^~@#$[\]]+$/

function parseTableOutput(stdout: string): { rows: Record<string, unknown>[]; columns: string[] } {
  const lines = stdout.trim().split('\n').filter(l => l.trim())
  if (lines.length < 3) return { rows: [], columns: [] }

  const sepLine = lines[1]
  if (!sepLine || !sepLine.includes('+') && !sepLine.includes('-')) return { rows: [], columns: [] }

  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean)
  const dataLines = lines.slice(2).filter(l => l.includes('|') && !l.includes('+') && !l.includes('---'))

  const rows = dataLines.map(line => {
    const values = line.split('|').map(v => v.trim())
    const row: Record<string, unknown> = {}
    headers.forEach((col, i) => {
      const val: string = values[i] ?? ''
      row[col] = /^\d+(\.\d+)?$/.test(val) ? (val.includes('.') ? parseFloat(val) : parseInt(val, 10)) : val
    })
    return row
  })

  return { rows, columns: headers }
}

function parseCsvOutput(stdout: string): { rows: Record<string, unknown>[]; columns: string[] } {
  function parseLine(l: string): string[] {
    const vals: string[] = []; let cur = ''; let inQ = false
    for (let i = 0; i < l.length; i++) {
      const c = l[i]
      if (c === '"') { if (inQ && i + 1 < l.length && l[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
      else if (c === ',' && !inQ) { vals.push(cur.trim()); cur = '' }
      else cur += c
    }
    vals.push(cur.trim()); return vals
  }

  const lines = stdout.trim().split('\n').filter(l => l.trim())
  if (lines.length < 1) return { rows: [], columns: [] }
  const columns = parseLine(lines[0])
  const rows = lines.slice(1).map(line => {
    const values = parseLine(line)
    const row: Record<string, unknown> = {}
    columns.forEach((col, i) => { row[col] = values[i] ?? null })
    return row
  })
  return { rows, columns }
}

export const PostgresQueryTool: ToolDef<InputSchema, Output> = {
  name: POSTGRES_QUERY_TOOL_NAME,
  searchHint: 'execute SQL queries against PostgreSQL',
  maxResultSizeChars: MAX_RESULT_CHARS,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Postgres Query',
  isReadOnly(input) {
    if (input && 'query' in input) {
      const q = String(input.query).trim().toLowerCase()
      return q.startsWith('select') || q.startsWith('with')
    }
    return false
  },
  isDestructive(input) {
    if (input && 'query' in input) {
      const q = String(input.query).trim().toLowerCase()
      return q.startsWith('drop') || q.startsWith('truncate') || q.startsWith('delete') || (q.startsWith('alter') && q.includes('drop'))
    }
    return false
  },
  toAutoClassifierInput(input) { return input.query.slice(0, 100) },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.query) return { result: false, message: 'Missing required parameter: query', errorCode: 1 }
    if (input.query.length > 10000) return { result: false, message: 'Query too long (max 10,000 characters)', errorCode: 1 }
    return { result: true }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return { type: 'text', text: `Executing PostgreSQL query: ${input.query.slice(0, 200)}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `Query failed: ${output.error}` }
    if (output.rows?.length) {
      const preview = output.truncated ? `Returned ${output.rowCount} rows (truncated, showing first ${output.rows.length})` : `Returned ${output.rowCount} rows`
      return { type: 'text', text: `${preview} in ${output.durationMs}ms` }
    }
    if (output.rowCount !== undefined) return { type: 'text', text: `${output.rowCount} rows affected in ${output.durationMs}ms` }
    return { type: 'text', text: `Query executed in ${output.durationMs}ms` }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const connStr = input.connection || process.env.PGDATABASE_URL || ''

    if (!connStr) return { data: { success: false, durationMs: Date.now() - startTime, error: 'No PostgreSQL connection configured. Set PGDATABASE_URL or provide connection parameter.' } }

    try {
      const args: string[] = ['--no-psqlrc', '--tuples-only']
      if (input.format === 'csv') args.push('--csv')
      else args.push('--aligned')
      args.push('-c', input.query, connStr)

      const result = spawnSync('psql', args, { timeout: (input.timeout ?? 30) * 1000, maxBuffer: MAX_RESULT_CHARS, encoding: 'utf-8', env: { ...process.env, PGCONNECT_TIMEOUT: String(input.timeout ?? 30), PGSSLMODE: 'require' } })

      const stdout = (result.stdout ?? '').trim()
      const stderr = (result.stderr ?? '').trim()
      const status = result.status ?? 1

      if (status !== 0 && !stdout) return { data: { success: false, durationMs: Date.now() - startTime, error: stderr || `psql exited with code ${status}` } }

      const { rows, columns } = input.format === 'csv' ? parseCsvOutput(stdout) : parseTableOutput(stdout)

      const isSelectLike = /^\s*(select|with|explain)\s/i.test(input.query)
      const rowCount = isSelectLike ? rows.length : (() => { const m = stdout.match(/INSERT \d+ (\d+)/); return m ? parseInt(m[1], 10) : undefined })()

      const truncated = rows.length > MAX_RESULT_ROWS
      return { data: { success: true, rows: truncated ? rows.slice(0, MAX_RESULT_ROWS) : rows, rowCount: rowCount ?? rows.length, columns: columns.length > 0 ? columns : undefined, durationMs: Date.now() - startTime, truncated } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, durationMs: Date.now() - startTime, error: msg.split('\n')[0] } }
    }
  },
}

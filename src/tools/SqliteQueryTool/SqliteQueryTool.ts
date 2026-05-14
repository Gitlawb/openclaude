import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, normalize } from 'path'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { checkReadPermissionForTool, checkWritePermissionForTool } from '../../utils/permissions/filesystem.js'
import { DESCRIPTION, SQLITE_QUERY_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string().describe('Path to SQLite database file (.db, .sqlite, .sqlite3)'),
    query: z.string().describe('SQL query'),
    mode: z.enum(['read', 'write']).optional().default('read').describe('Access mode'),
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
    dbPath: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_RESULT_ROWS = 1000
const MAX_RESULT_CHARS = 100_000

function parseOutput(stdout: string): { rows: Record<string, unknown>[]; columns: string[] } {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>[]
    if (Array.isArray(parsed)) {
      const columns = parsed.length > 0 ? Object.keys(parsed[0]) : []
      return { rows: parsed, columns }
    }
  } catch { /* fall through to pipe parsing for older sqlite */ }
  // Fallback for sqlite3 without -json support: parse pipe-separated output
  const lines = stdout.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return { rows: [], columns: [] }
  const columns = lines[0].split('|').map(c => c.trim())
  const rows = lines.slice(1).map(line => {
    const vals = line.split('|').map(v => v.trim())
    const row: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      let v: unknown = vals[i] ?? null
      if (v === 'NULL') v = null
      else { const n = Number(v); if (!isNaN(n) && v !== '') v = n }
      row[col] = v
    })
    return row
  })
  return { rows, columns }
}

function isWriteQuery(q: string): boolean {
  const t = q.trim().toLowerCase()
  return !t.startsWith('select') && !t.startsWith('with') && !t.startsWith('pragma') && !t.startsWith('explain')
}

export const SqliteQueryTool = buildTool({
  name: SQLITE_QUERY_TOOL_NAME,
  searchHint: 'query a local SQLite database',
  maxResultSizeChars: MAX_RESULT_CHARS,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'SQLite Query',
  isReadOnly(input) {
    if (input?.mode === 'write') return false
    if (input?.query && isWriteQuery(input.query)) return false
    return true
  },
  isDestructive(input) {
    if (input?.query) { const q = input.query.trim().toLowerCase(); return q.startsWith('drop') || q.startsWith('truncate') || q.startsWith('delete') || (q.startsWith('alter') && q.includes('drop')) }
    return false
  },
  toAutoClassifierInput(input) { return `${input.path}: ${input.query.slice(0, 100)}` },
  getPath({ path }): string { return path || '' },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.path) return { result: false, message: 'Missing path', errorCode: 1 }
    if (!input.query) return { result: false, message: 'Missing query', errorCode: 1 }
    if (input.query.length > 10000) return { result: false, message: 'Query too long', errorCode: 1 }
    const f = resolve(expandPath(input.path))
    if (!f.endsWith('.db') && !f.endsWith('.sqlite') && !f.endsWith('.sqlite3')) return { result: false, message: 'File must have .db, .sqlite, or .sqlite3 extension', errorCode: 1 }
    return { result: true }
  },
  async checkPermissions(input, context) {
    const appState = context.getAppState()
    if (input.mode === 'write') {
      return checkWritePermissionForTool(SqliteQueryTool, input, appState.toolPermissionContext)
    }
    return checkReadPermissionForTool(SqliteQueryTool, input, appState.toolPermissionContext)
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return `Querying SQLite ${input.path}: ${input.query.slice(0, 150)}`
  },
  renderToolResultMessage(output) {
    if (!output.success) return `SQLite query failed on ${output.dbPath}: ${output.error}`
    if (output.rows?.length) return `Returned ${output.rowCount} rows from ${output.dbPath} in ${output.durationMs}ms${output.truncated ? ' (truncated)' : ''}`
    if (output.rowCount !== undefined) return `${output.rowCount} rows affected on ${output.dbPath} in ${output.durationMs}ms`
    return `Query executed on ${output.dbPath} in ${output.durationMs}ms`
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?) {
    const startTime = Date.now()
    const resolvedPath = normalize(resolve(expandPath(input.path)))
    if (!existsSync(resolvedPath)) return { data: { success: false, durationMs: Date.now() - startTime, error: `Database file not found: ${resolvedPath}`, dbPath: resolvedPath } }

    const readOnly = input.mode === 'read'
    if (readOnly && isWriteQuery(input.query)) return { data: { success: false, durationMs: Date.now() - startTime, error: `Write queries not allowed in read mode. Set mode to 'write' to execute: ${input.query.slice(0, 100)}`, dbPath: resolvedPath } }

    try {
      const args: string[] = ['-json']
      if (readOnly) args.push('-readonly')
      args.push(resolvedPath, input.query)

      const result = spawnSync('sqlite3', args, { timeout: 30000, maxBuffer: MAX_RESULT_CHARS, encoding: 'utf-8' })
      if (result.error) return { data: { success: false, durationMs: Date.now() - startTime, error: `Binary not found: sqlite3. Install it and try again.`, dbPath: resolvedPath } }
      const stdout = (result.stdout ?? '').trim()
      const stderr = (result.stderr ?? '').trim()

      if ((result.status ?? 1) !== 0) return { data: { success: false, durationMs: Date.now() - startTime, error: (stdout + '\n' + stderr).trim().slice(0, 2000) || `sqlite3 exited with code ${result.status}`, dbPath: resolvedPath } }

      // Parse JSON output (handles all text values correctly, no pipe-separator corruption)
      const { rows, columns } = parseOutput(stdout)

      // For write queries, get affected row count from a separate invocation
      let rowCount: number | undefined
      if (isWriteQuery(input.query)) {
        try {
          const cr = spawnSync('sqlite3', ['-json', resolvedPath, 'SELECT changes()'], { timeout: 5000, encoding: 'utf-8' })
          if (!cr.error && (cr.status ?? 0) === 0) {
            const crParsed = JSON.parse(cr.stdout ?? '[]') as Array<Record<string, unknown>>
            rowCount = parseInt(String(crParsed[0]?.['changes()'] ?? -1), 10)
            if (isNaN(rowCount) || rowCount < 0) rowCount = undefined
          }
        } catch { rowCount = rows.length }
      } else rowCount = rows.length

      const truncated = rows.length > MAX_RESULT_ROWS
      return { data: { success: true, rows: truncated ? rows.slice(0, MAX_RESULT_ROWS) : rows, rowCount: rowCount ?? rows.length, columns, durationMs: Date.now() - startTime, truncated, dbPath: resolvedPath } }
    } catch (err) {
      return { data: { success: false, durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err), dbPath: resolvedPath } }
    }
  },
})

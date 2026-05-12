import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, normalize } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { checkReadPermissionForTool } from '../../utils/permissions/filesystem.js'
import { DESCRIPTION, SQLITE_QUERY_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string().describe('Path to SQLite database file (.db, .sqlite, .sqlite3)'),
    query: z.string().describe('SQL query to execute'),
    mode: z.enum(['read', 'write']).optional().default('read').describe('Access mode: read-only or read-write'),
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
  const lines = stdout.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return { rows: [], columns: [] }
  const columns = lines[0].split('|').map(c => c.trim())
  const rows = lines.slice(1).map(line => {
    const values = line.split('|').map(v => v.trim())
    const row: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      let val: unknown = values[i] ?? null
      if (val === 'NULL') val = null
      else { const n = Number(val); if (!isNaN(n) && val !== '') val = n }
      row[col] = val
    })
    return row
  })
  return { rows, columns }
}

function isWriteQuery(q: string): boolean {
  const t = q.trim().toLowerCase()
  return !t.startsWith('select') && !t.startsWith('with') && !t.startsWith('pragma') && !t.startsWith('explain')
}

export const SqliteQueryTool: ToolDef<InputSchema, Output> = {
  name: SQLITE_QUERY_TOOL_NAME,
  searchHint: 'query a local SQLite database',
  maxResultSizeChars: MAX_RESULT_CHARS,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'SQLite Query',
  isReadOnly(input) {
    if (input && input.mode === 'write') return false
    if (input && input.query && isWriteQuery(input.query)) return false
    return true
  },
  isDestructive(input) {
    if (input && 'query' in input) {
      const q = String(input.query).trim().toLowerCase()
      return q.startsWith('drop') || q.startsWith('truncate') || q.startsWith('delete') || (q.startsWith('alter') && q.includes('drop'))
    }
    return false
  },
  toAutoClassifierInput(input) { return `${input.path}: ${input.query.slice(0, 100)}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.path) return { result: false, message: 'Missing required parameter: path', errorCode: 1 }
    if (!input.query) return { result: false, message: 'Missing required parameter: query', errorCode: 1 }
    if (input.query.length > 10000) return { result: false, message: 'Query too long', errorCode: 1 }
    const f = resolve(expandPath(input.path))
    if (!f.endsWith('.db') && !f.endsWith('.sqlite') && !f.endsWith('.sqlite3')) return { result: false, message: 'File must have .db, .sqlite, or .sqlite3 extension', errorCode: 1 }
    return { result: true }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return { type: 'text', text: `Querying SQLite ${input.path}: ${input.query.slice(0, 150)}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `SQLite query failed on ${output.dbPath}: ${output.error}` }
    if (output.rows?.length) {
      const preview = output.truncated ? `Returned ${output.rowCount} rows (truncated)` : `Returned ${output.rowCount} rows`
      return { type: 'text', text: `${preview} from ${output.dbPath} in ${output.durationMs}ms` }
    }
    if (output.rowCount !== undefined) return { type: 'text', text: `${output.rowCount} rows affected on ${output.dbPath} in ${output.durationMs}ms` }
    return { type: 'text', text: `Query executed on ${output.dbPath} in ${output.durationMs}ms` }
  },
  async call(input, ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const resolvedPath = normalize(resolve(expandPath(input.path)))

    if (!existsSync(resolvedPath)) return { data: { success: false, durationMs: Date.now() - startTime, error: `Database file not found: ${resolvedPath}`, dbPath: resolvedPath } }

    // Permission check: use the same file permission helper as FileRead/Grep
    if (input.mode === 'read') {
      const permResult = await checkReadPermissionForTool(resolvedPath, ctx)
      if (permResult.behavior === 'deny') return { data: { success: false, durationMs: Date.now() - startTime, error: `Permission denied: ${resolvedPath}`, dbPath: resolvedPath } }
    }

    try {
      const readOnly = input.mode === 'read'
      // Enforce read-only at the SQLite layer: reject write queries in read mode
      if (readOnly && isWriteQuery(input.query)) return { data: { success: false, durationMs: Date.now() - startTime, error: `Write queries are not allowed in read mode. Set mode to 'write' to execute: ${input.query.slice(0, 100)}`, dbPath: resolvedPath } }

      const args: string[] = ['-header', '-separator', '|']
      if (readOnly) args.push('-readonly')
      args.push(resolvedPath, input.query)

      const result = spawnSync('sqlite3', args, { timeout: 30000, maxBuffer: MAX_RESULT_CHARS, encoding: 'utf-8' })
      const stdout = (result.stdout ?? '').trim()
      const stderr = (result.stderr ?? '').trim()

      if ((result.status ?? 1) !== 0 && !stdout) return { data: { success: false, durationMs: Date.now() - startTime, error: stderr || `sqlite3 exited with code ${result.status}`, dbPath: resolvedPath } }

      const { rows, columns } = parseOutput(stdout)
      const isSelectLike = !isWriteQuery(input.query)

      let rowCount: number | undefined
      if (!isSelectLike) {
        try {
          const cr = spawnSync('sqlite3', [resolvedPath, 'SELECT changes()'], { timeout: 5000, encoding: 'utf-8' })
          rowCount = parseInt((cr.stdout ?? '').trim(), 10)
        } catch { rowCount = rows.length }
      } else rowCount = rows.length

      const truncated = rows.length > MAX_RESULT_ROWS
      return { data: { success: true, rows: truncated ? rows.slice(0, MAX_RESULT_ROWS) : rows, rowCount: rowCount ?? rows.length, columns: columns.length > 0 ? columns : undefined, durationMs: Date.now() - startTime, truncated, dbPath: resolvedPath } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, durationMs: Date.now() - startTime, error: msg, dbPath: resolvedPath } }
    }
  },
}

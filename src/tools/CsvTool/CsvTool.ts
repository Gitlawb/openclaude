import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, CSV_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['read', 'query', 'stats']).describe('CSV action'),
    path: z.string().describe('Path to CSV file'),
    columns: z.array(z.string()).optional().describe('Columns to select (default: all)'),
    filter: z.string().optional().describe('Filter expression (e.g. "age > 18")'),
    limit: z.number().min(1).max(5000).optional().default(100).describe('Max rows to return'),
    delimiter: z.string().optional().default(',').describe('Field delimiter'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    rows: z.array(z.record(z.unknown())).optional(),
    rowCount: z.number(),
    columns: z.array(z.string()).optional(),
    stats: z.record(z.object({ type: z.string(), count: z.number(), unique: z.number().optional(), min: z.unknown().optional(), max: z.unknown().optional() })).optional(),
    error: z.string().optional(),
    durationMs: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_ROWS_DISPLAY = 5000

function parseCsvLine(line: string, delimiter: string): string[] {
  const vals: string[] = []; let cur = ''; let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (inQ && i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (c === delimiter && !inQ) { vals.push(cur.trim()); cur = '' }
    else cur += c
  }
  vals.push(cur.trim())
  return vals
}

function coerceValue(s: string): unknown {
  if (s === '' || s === 'NULL' || s === 'null') return null
  if (s === 'true' || s === 'TRUE') return true
  if (s === 'false' || s === 'FALSE') return false
  const n = Number(s); if (!isNaN(n) && s.trim() !== '') return n
  return s
}

function applyFilter(row: Record<string, unknown>, filter: string): boolean {
  // Simple filter parsing: "column op value" where op is >, <, >=, <=, =, !=
  const m = filter.match(/^\s*(\w+)\s*(>=|<=|!=|>|<|=)\s*(.+)\s*$/)
  if (!m) return true
  const [, col, op, rawVal] = m
  const val = row[col]; if (val === undefined) return true
  const cmp = String(val).localeCompare(rawVal.trim().replace(/^['"]/, '').replace(/['"]$/, ''), undefined, { numeric: true })
  if (op === '=') return cmp === 0
  if (op === '!=') return cmp !== 0
  if (op === '>') return cmp > 0
  if (op === '<') return cmp < 0
  if (op === '>=') return cmp >= 0
  if (op === '<=') return cmp <= 0
  return true
}

export const CsvTool = buildTool({
  name: CSV_TOOL_NAME,
  searchHint: 'read, query, and analyze CSV files',
  maxResultSizeChars: 100_000,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'CSV Tool',
  isReadOnly() { return true },
  isDestructive() { return false },
  toAutoClassifierInput(input) { return `${input.action} ${input.path}` },
  getPath(input) { return input.path },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.path) return { result: false, message: 'Missing required parameter: path', errorCode: 1 }
    if (input.delimiter && input.delimiter.length !== 1) return { result: false, message: 'Delimiter must be a single character', errorCode: 1 }
    return { result: true }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return { type: 'text', text: `${input.action} ${input.path}${input.filter ? ` where ${input.filter}` : ''}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `CSV ${output.action} failed: ${output.error}` }
    return { type: 'text', text: `${output.action}: ${output.rowCount} rows${output.columns ? `, ${output.columns.length} columns` : ''} in ${output.durationMs}ms` }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const filePath = resolve(expandPath(input.path))

    if (!existsSync(filePath)) return { data: { success: false, action: input.action, rowCount: 0, durationMs: Date.now() - startTime, error: `File not found: ${filePath}` } }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      if (lines.length < 1) return { data: { success: false, action: input.action, rowCount: 0, durationMs: Date.now() - startTime, error: 'Empty file' } }

      const delimiter = input.delimiter ?? ','
      const headers = parseCsvLine(lines[0], delimiter)
      const rawRows = lines.slice(1).map(line => {
        const vals = parseCsvLine(line, delimiter)
        const row: Record<string, unknown> = {}
        headers.forEach((h, i) => { row[h] = vals[i] !== undefined ? coerceValue(vals[i]) : null })
        return row
      })

      let filteredRows = rawRows
      if (input.filter) filteredRows = rawRows.filter(r => applyFilter(r, input.filter))
      if (input.columns) {
        const cols = new Set(input.columns)
        filteredRows = filteredRows.map(r => { const o: Record<string, unknown> = {}; cols.forEach(c => { if (c in r) o[c] = r[c] }); return o })
      }

      const truncated = filteredRows.length > (input.limit ?? 100)
      const rows = truncated ? filteredRows.slice(0, input.limit ?? 100) : filteredRows

      if (input.action === 'stats') {
        const stats: Output['stats'] = {}
        headers.forEach(h => {
          const vals = rawRows.map(r => String(r[h] ?? '')).filter(v => v !== '')
          const nums = vals.map(Number).filter(n => !isNaN(n))
          const s: any = { type: nums.length === vals.length ? 'number' : 'string', count: vals.length, unique: new Set(vals).size }
          if (nums.length > 0) { s.min = Math.min(...nums); s.max = Math.max(...nums) }
          stats[h] = s
        })
        return { data: { success: true, action: input.action, rowCount: rawRows.length, columns: headers, stats, durationMs: Date.now() - startTime } }
      }

      return { data: { success: true, action: input.action, rows: rows.slice(0, MAX_ROWS_DISPLAY), rowCount: filteredRows.length, columns: headers, durationMs: Date.now() - startTime } }
    } catch (err) {
      return { data: { success: false, action: input.action, rowCount: 0, durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err) } }
    }
  },
})

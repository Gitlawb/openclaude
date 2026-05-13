import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, JSON_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['read', 'query', 'validate']).describe('JSON action'),
    path: z.string().describe('Path to JSON file'),
    expression: z.string().optional().describe('Dot-notation path to query (e.g. "users[0].name")'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    data: z.unknown().optional(),
    error: z.string().optional(),
    isArray: z.boolean().optional(),
    keyCount: z.number().optional(),
    durationMs: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_SIZE_BYTES = 100_000

function resolvePath(obj: unknown, expr: string): unknown {
  if (!expr) return obj
  // Parse bracket notation: users[0] → users.0, users[] → users
  const normalized = expr.replace(/\[(\d+)\]/g, '.$1').replace(/\[\]/g, '')
  const parts = normalized.split('.').filter(Boolean)
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current) && part === '' && parts.indexOf(part) === parts.length - 1) {
      // users[] at end: collect property from all items
      return current
    }
    if (Array.isArray(current) && !isNaN(Number(part))) {
      current = (current as unknown[])[Number(part)]
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part]
    } else return undefined
  }
  return current
}

export const JsonTool = buildTool({
  name: JSON_TOOL_NAME,
  searchHint: 'read, query, and validate JSON files',
  maxResultSizeChars: 100_000,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'JSON Query',
  isReadOnly() { return true },
  isDestructive() { return false },
  toAutoClassifierInput(input) { return `${input.action} ${input.path}` },
  getPath(input) { return input.path },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.path) return { result: false, message: 'Missing required parameter: path', errorCode: 1 }
    if (input.action === 'query' && !input.expression) return { result: false, message: 'Expression required for query action', errorCode: 1 }
    return { result: true }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return { type: 'text', text: `${input.action} ${input.path}${input.expression ? ` → ${input.expression}` : ''}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `JSON ${output.action} failed: ${output.error}` }
    if (output.action === 'validate') return { type: 'text', text: `Valid JSON${output.keyCount !== undefined ? ` with ${output.keyCount} top-level keys` : ''} in ${output.durationMs}ms` }
    return { type: 'text', text: `JSON ${output.action} completed in ${output.durationMs}ms` }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const filePath = resolve(expandPath(input.path))

    if (!existsSync(filePath)) return { data: { success: false, action: input.action, durationMs: Date.now() - startTime, error: `File not found: ${filePath}` } }

    try {
      const content = readFileSync(filePath, 'utf-8')
      if (content.length > MAX_SIZE_BYTES) return { data: { success: false, action: input.action, durationMs: Date.now() - startTime, error: `File too large (${content.length} bytes, max ${MAX_SIZE_BYTES})` } }

      const parsed = JSON.parse(content) as unknown

      if (input.action === 'validate') {
        const keyCount = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.keys(parsed as Record<string, unknown>).length : undefined
        return { data: { success: true, action: input.action, keyCount, durationMs: Date.now() - startTime } }
      }

      if (input.action === 'read') {
        return { data: { success: true, action: input.action, data: parsed, isArray: Array.isArray(parsed), keyCount: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.keys(parsed as Record<string, unknown>).length : undefined, durationMs: Date.now() - startTime } }
      }

      if (input.action === 'query' && input.expression) {
        const result = resolvePath(parsed, input.expression)
        return { data: { success: true, action: input.action, data: result, isArray: Array.isArray(result), durationMs: Date.now() - startTime } }
      }

      return { data: { success: true, action: input.action, durationMs: Date.now() - startTime } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, action: input.action, durationMs: Date.now() - startTime, error: msg.includes('Unexpected token') ? `Invalid JSON: ${msg}` : msg } }
    }
  },
})

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, GRAPHQL_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    endpoint: z.string().url().describe('GraphQL endpoint URL'),
    query: z.string().min(1).describe('GraphQL query or mutation'),
    variables: z.record(z.unknown()).optional().describe('Query variables'),
    operationName: z.string().optional().describe('Operation name'),
    headers: z.record(z.string()).optional().describe('Custom headers'),
    timeout: z.number().min(1).max(300).optional().default(30).describe('Request timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    errors: z.array(z.object({ message: z.string(), locations: z.array(z.object({ line: z.number(), column: z.number() })).optional() })).optional(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_RESPONSE_CHARS = 100_000

// Strip GraphQL comments before detecting operation type
function strippedQuery(q: string): string {
  return q.replace(/#[^\n]*/g, '').trim()
}

export const GraphqlTool = buildTool({
  name: GRAPHQL_TOOL_NAME,
  searchHint: 'execute GraphQL queries and mutations',
  maxResultSizeChars: MAX_RESPONSE_CHARS,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'GraphQL Query',
  isReadOnly(input) {
    if (input && 'query' in input) return !strippedQuery(input.query).match(/^(mutation|subscription)\s/i)
    return true
  },
  isDestructive() { return false },
  toAutoClassifierInput(input) { return `${input.endpoint}: ${input.query.slice(0, 80)}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.endpoint) return { result: false, message: 'Missing required parameter: endpoint', errorCode: 1 }
    if (!input.query) return { result: false, message: 'Missing required parameter: query', errorCode: 1 }
    try { new URL(input.endpoint) } catch { return { result: false, message: 'Invalid endpoint URL', errorCode: 1 } }
    return { result: true }
  },
  async checkPermissions(input) {
    const sq = strippedQuery(input.query)
    const isMut = sq.match(/^(mutation|subscription)\s/i)
    if (isMut) return { behavior: 'ask', message: `Send ${isMut[1].toUpperCase()} to ${input.endpoint}?`, updatedInput: input }
    return { behavior: 'allow', updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    const type = String(input.query).trim().match(/^\s*(query|mutation|subscription)/i)?.[1]?.toUpperCase() ?? 'QUERY'
    return { type: 'text', text: `${type} ${input.endpoint}` }
  },
  renderToolResultMessage(output) {
    if (!output.success && output.error) return { type: 'text', text: `GraphQL request failed: ${output.error}` }
    if (output.errors?.length) return { type: 'text', text: `GraphQL returned ${output.errors.length} error(s) in ${output.durationMs}ms` }
    return { type: 'text', text: `GraphQL query succeeded in ${output.durationMs}ms` }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?) {
    const startTime = Date.now()
    try {
      const body: Record<string, unknown> = { query: input.query }
      if (input.variables) body.variables = input.variables
      if (input.operationName) body.operationName = input.operationName
      const resp = await fetch(input.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...input.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout((input.timeout ?? 30) * 1000) })
      const text = await resp.text()
      if (text.length > MAX_RESPONSE_CHARS) return { data: { success: false, durationMs: Date.now() - startTime, error: 'Response too large' } }
      const parsed = JSON.parse(text) as { data?: unknown; errors?: Array<{ message: string; locations?: Array<{ line: number; column: number }> }> }
      return { data: { success: !(parsed.errors?.length), data: parsed.data, errors: parsed.errors, durationMs: Date.now() - startTime } }
    } catch (err) {
      return { data: { success: false, durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err) } }
    }
  },
})

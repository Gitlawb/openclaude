import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { setCleanupTimeout } from '../../utils/cleanupRegistry.js'
import { DESCRIPTION, HTTP_REQUEST_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET').describe('HTTP method'),
    url: z.string().url().describe('Request URL'),
    headers: z.record(z.string()).optional().describe('Request headers'),
    query: z.record(z.string()).optional().describe('Query parameters'),
    body: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional().describe('Request body'),
    timeout: z.number().min(1).max(300).optional().default(30).describe('Request timeout in seconds'),
    followRedirects: z.boolean().optional().default(true).describe('Follow redirects'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    response: z.object({ status: z.number(), statusText: z.string(), headers: z.record(z.string()), body: z.string(), bodyTruncated: z.boolean().optional() }).optional(),
    redirectChain: z.array(z.string()).optional(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_BODY_CHARS = 50_000
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const HttpRequestTool = buildTool({
  name: HTTP_REQUEST_TOOL_NAME,
  searchHint: 'make HTTP requests to test REST APIs',
  maxResultSizeChars: MAX_BODY_CHARS,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'HTTP Request',
  isReadOnly(input) { return input ? SAFE_METHODS.has(input.method) : true },
  isDestructive(input) { return input ? !SAFE_METHODS.has(input.method) : false },
  toAutoClassifierInput(input) { return `${input.method} ${input.url}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.url) return { result: false, message: 'Missing required parameter: url', errorCode: 1 }
    try { new URL(input.url) } catch { return { result: false, message: 'Invalid URL format', errorCode: 1 } }
    return { result: true }
  },
  async checkPermissions(input) {
    return { behavior: 'ask', message: `Send ${input.method} to ${input.url}?`, updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return { type: 'text', text: `${input.method ?? 'GET'} ${input.url}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `Request failed: ${output.error}` }
    if (!output.response) return { type: 'text', text: 'No response received' }
    const icon = output.response.status >= 200 && output.response.status < 300 ? '✅' : output.response.status >= 400 ? '❌' : '⚠️'
    return { type: 'text', text: `${icon} ${output.response.status} ${output.response.statusText} (${output.durationMs}ms)` }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?) {
    const startTime = Date.now()
    try {
      const urlObj = new URL(input.url)
      if (input.query) for (const [k, v] of Object.entries(input.query)) urlObj.searchParams.set(k, v)
      const headers: Record<string, string> = { ...input.headers }
      const ac = new AbortController()
      setCleanupTimeout(() => { try { ac.abort() } catch {} }, (input.timeout ?? 30) * 1000)
      const fetchOpts: RequestInit = { method: input.method, headers, redirect: input.followRedirects ? 'follow' : 'manual', signal: ac.signal }
      if (input.body) {
        const bodyStr = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
        if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = typeof input.body === 'string' && !(input.body as string).startsWith('{') && !(input.body as string).startsWith('[') ? 'text/plain' : 'application/json'
        fetchOpts.body = bodyStr
      }
      const resp = await fetch(urlObj.toString(), fetchOpts)
      let bodyText = await resp.text()
      const bodyTruncated = bodyText.length > MAX_BODY_CHARS
      if (bodyTruncated) bodyText = bodyText.slice(0, MAX_BODY_CHARS)
      const respHeaders: Record<string, string> = {}
      resp.headers.forEach((v, k) => { respHeaders[k] = v })
      return { data: { success: true, response: { status: resp.status, statusText: resp.statusText, headers: respHeaders, body: bodyText, bodyTruncated }, durationMs: Date.now() - startTime } }
    } catch (err) {
      return { data: { success: false, durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err) } }
    }
  },
})

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { formatFileSize } from '../../utils/format.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { isPreapprovedHost } from './preapproved.js'
import { DESCRIPTION, WEB_FETCH_TOOL_NAME } from './prompt.js'
import { getToolUseSummary, renderToolResultMessage, renderToolUseMessage, renderToolUseProgressMessage } from './UI.js'
import { applyPromptToMarkdown, isPreapprovedUrl, MAX_MARKDOWN_LENGTH } from './utils.js'
import { runFetch, getProviderMode } from './providers/index.js'
import type { RedirectInfo } from './providers/types.js'

const inputSchema = lazySchema(() => z.strictObject({
  url: z.string().url().describe('The URL to fetch content from'),
  prompt: z.string().describe('The prompt to run on the fetched content'),
}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.object({
  bytes: z.number().describe('Size of the fetched content in bytes'),
  code: z.number().describe('HTTP response code'),
  codeText: z.string().describe('HTTP response code text'),
  result: z.string().describe('Processed result from applying the prompt to the content'),
  durationMs: z.number().describe('Time taken to fetch and process the content'),
  url: z.string().describe('The URL that was fetched'),
}))
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function webFetchToolInputToPermissionRuleContent(input: { [k: string]: unknown }): string {
  try {
    const p = WebFetchTool.inputSchema.safeParse(input)
    if (!p.success) return `input:${input.toString()}`
    return `domain:${new URL(p.data.url).hostname}`
  } catch { return `input:${input.toString()}` }
}

export const WebFetchTool = buildTool({
  name: WEB_FETCH_TOOL_NAME,
  searchHint: 'fetch and extract content from a URL',
  maxResultSizeChars: 2_000_000,
  shouldDefer: true,
  async description(input) {
    const { url } = input as { url: string }
    try { return `Claude wants to fetch content from ${new URL(url).hostname}` }
    catch { return 'Claude wants to fetch content from this URL' }
  },
  userFacingName() { return 'Fetch' },
  getToolUseSummary,
  getActivityDescription(input) { return getToolUseSummary(input) ? `Fetching ${getToolUseSummary(input)}` : 'Fetching web page' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  toAutoClassifierInput(input) { return input.prompt ? `${input.url}: ${input.prompt}` : input.url },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const perm = appState.toolPermissionContext
    try {
      const { url } = input as { url: string }
      if (isPreapprovedHost(new URL(url).hostname, new URL(url).pathname))
        return { behavior: 'allow', updatedInput: input, decisionReason: { type: 'other', reason: 'Preapproved host' } }
    } catch {}
    const rc = webFetchToolInputToPermissionRuleContent(input)
    const deny = getRuleByContentsForTool(perm, WebFetchTool, 'deny').get(rc)
    if (deny) return { behavior: 'deny', message: `${WebFetchTool.name} denied access to ${rc}.`, decisionReason: { type: 'rule', rule: deny } }
    const ask = getRuleByContentsForTool(perm, WebFetchTool, 'ask').get(rc)
    if (ask) return { behavior: 'ask', message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`, decisionReason: { type: 'rule', rule: ask }, suggestions: buildSuggestions(rc) }
    const allow = getRuleByContentsForTool(perm, WebFetchTool, 'allow').get(rc)
    if (allow) return { behavior: 'allow', updatedInput: input, decisionReason: { type: 'rule', rule: allow } }
    return { behavior: 'ask', message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`, suggestions: buildSuggestions(rc) }
  },
  async prompt() {
    return `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.\n${DESCRIPTION}`
  },
  async validateInput(input) {
    try { new URL(input.url) } catch { return { result: false, message: `Error: Invalid URL "${input.url}".`, meta: { reason: 'invalid_url' }, errorCode: 1 } }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call({ url, prompt }, { abortController, options: { isNonInteractiveSession } }, _can, _parent, onProgress) {
    const start = Date.now()
    let pc = 0
    const emit = (s: string) => { pc++; onProgress?.({ toolUseID: `fetch-progress-${pc}`, data: { step: s } }) }
    const mode = getProviderMode()
    const host = (() => { try { return new URL(url).hostname } catch { return url } })()
    emit(`Fetching ${host} via ${mode}…`)

    const response = await runFetch(url, abortController.signal)

    if ('type' in response && response.type === 'redirect') {
      const r = response as RedirectInfo
      const st = r.statusCode === 301 ? 'Moved Permanently' : r.statusCode === 308 ? 'Permanent Redirect' : r.statusCode === 307 ? 'Temporary Redirect' : 'Found'
      return { data: { bytes: Buffer.byteLength(JSON.stringify(r)), code: r.statusCode, codeText: st, result: `REDIRECT DETECTED: The URL redirects to a different host.\n\nOriginal URL: ${r.originalUrl}\nRedirect URL: ${r.redirectUrl}\nStatus: ${r.statusCode} ${st}\n\nTo complete your request, use WebFetch again with:\n- url: "${r.redirectUrl}"\n- prompt: "${prompt}"`, durationMs: Date.now() - start, url } satisfies Output }
    }

    emit('Processing content…')
    const { content, bytes, code, codeText, contentType, persistedPath, persistedSize } = response
    const isPre = isPreapprovedUrl(url)
    const isCode = contentType.includes('text/plain') || contentType.includes('text/x-') || contentType.includes('application/json') || contentType.includes('application/javascript') || contentType.includes('application/typescript') || contentType.includes('application/xml') || contentType.includes('application/x-sh')
    const isRaw = /\/raw\//.test(url) || url.includes('raw.githubusercontent.com') || url.includes('/plain/')
    const shouldRaw = isCode || isRaw

    let result: string
    if (shouldRaw && content.length < MAX_MARKDOWN_LENGTH) result = content
    else if (isPre && contentType.includes('text/markdown') && content.length < MAX_MARKDOWN_LENGTH) result = content
    else result = await applyPromptToMarkdown(prompt, content, abortController.signal, isNonInteractiveSession, isPre)

    if (persistedPath) result += `\n\n[Binary content (${contentType}, ${formatFileSize(persistedSize ?? bytes)}) also saved to ${persistedPath}]`
    return { data: { bytes, code, codeText, result, durationMs: Date.now() - start, url } satisfies Output }
  },
  mapToolResultToToolResultBlockParam({ result, url, bytes, code, codeText, durationMs }, toolUseID) {
    const sz = formatFileSize(bytes), sec = (durationMs / 1000).toFixed(1)
    return { tool_use_id: toolUseID, type: 'tool_result', content: `Web fetch result for: ${url}\nStatus: ${code} ${codeText} | Size: ${sz} | Duration: ${sec}s\n\n${result}` }
  },
} satisfies ToolDef<InputSchema, Output>)

function buildSuggestions(rc: string): PermissionUpdate[] {
  return [{ type: 'addRules', destination: 'localSettings', rules: [{ toolName: WEB_FETCH_TOOL_NAME, ruleContent: rc }], behavior: 'allow' }]
}

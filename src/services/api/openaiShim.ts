import { requestFreeTokenActivation, FreeTokensRequiredError } from '../oauth/freeTokenActivation.js'
/**
 * OpenAI-compatible API shim for Claude Code.
 *
 * Translates Anthropic SDK calls (anthropic.beta.messages.create) into
 * OpenAI-compatible chat completion requests and streams back events
 * in the Anthropic streaming format so the rest of the codebase is unaware.
 *
 * Supports: OpenAI, Azure OpenAI, Ollama, LM Studio, OpenRouter,
 * Together, Groq, Fireworks, DeepSeek, Mistral, and any OpenAI-compatible API.
 *
 * Environment variables:
 *   CLAUDE_CODE_USE_OPENAI=1          — enable this provider
 *   OPENAI_API_KEY=sk-...             — API key (optional for local models)
 *   OPENAI_AUTH_HEADER=api-key        — optional custom auth header name
 *   OPENAI_AUTH_HEADER_VALUE=...      — optional custom auth header value
 *   OPENAI_AUTH_SCHEME=bearer|raw     — auth scheme for Authorization/custom header handling
 *   OPENAI_API_FORMAT=chat_completions|responses — request format for compatible APIs
 *   OPENAI_BASE_URL=http://...        — base URL (default: https://api.openai.com/v1)
 *   OPENAI_MODEL=gpt-4o              — default model override
 *   CODEX_API_KEY / ~/.codex/auth.json — Codex auth for codexplan/codexspark
 *
 * GitHub Copilot API (api.githubcopilot.com), OpenAI-compatible:
 *   CLAUDE_CODE_USE_GITHUB=1         — enable GitHub inference (no need for USE_OPENAI)
 *   GITHUB_TOKEN or GH_TOKEN         — Copilot API token (mapped to Bearer auth)
 *   OPENAI_MODEL                     — optional; use github:copilot or openai/gpt-4.1 style IDs
 */

import { randomUUID } from 'crypto'
import { APIError } from '@anthropic-ai/sdk'
import {
  resolveToolNameByUniquePrefix,
  TOOL_NAME_PREFIX_RECOVERY_ALLOWED,
} from '../../Tool.js'
import { getSessionId } from '../../bootstrap/state.js'
import { isVerbooMode, VERBOO_ROUTER_URL } from '../../constants/oauth.js'
import {
  readCodexCredentialsAsync,
  refreshCodexAccessTokenIfNeeded,
} from '../../utils/codexCredentials.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode, isEnvTruthy } from '../../utils/envUtils.js'
import { resolveGeminiCredential } from '../../utils/geminiAuth.js'
import { hydrateGeminiAccessTokenFromSecureStorage } from '../../utils/geminiCredentials.js'
import { hydrateGithubModelsTokenFromSecureStorage } from '../../utils/githubModelsCredentials.js'
import { resolveOpenAIShimRuntimeContext } from '../../integrations/runtimeMetadata.js'
import { resolveRouteCredentialValue } from '../../integrations/routeMetadata.js'
import { createThinkTagFilter, stripThinkTags } from './thinkTagSanitizer.js'
import {
  codexStreamToAnthropic,
  collectCodexCompletedResponse,
  convertAnthropicMessagesToResponsesInput,
  convertCodexResponseToAnthropicMessage,
  convertToolsToResponsesTools,
  performCodexRequest,
  type AnthropicStreamEvent,
  type AnthropicUsage,
  type ShimCreateParams,
} from './codexShim.js'
import { buildAnthropicUsageFromRawUsage } from './cacheMetrics.js'
import { compressToolHistory } from './compressToolHistory.js'
import { fetchWithProxyRetry } from './fetchWithProxyRetry.js'
import {
  delegateImagesInMessages,
  isVisionDelegationEnabled,
  messagesContainImages,
  modelSupportsVision,
  pickVisionModel,
  stripResidualImageParts,
} from './visionDelegate.js'
import {
  getLocalFastPathConfig,
  getLocalProviderRetryBaseUrls,
  getGithubEndpointType,
  isLocalProviderUrl,
  resolveStoredCodexCredentials,
  resolveRuntimeCodexCredentials,
  resolveProviderRequest,
  shouldAttemptLocalToollessRetry,
  type LocalFastPathConfig,
  type ResolvedCodexCredentials,
} from './providerConfig.js'
import {
  buildOpenAICompatibilityErrorMessage,
  classifyOpenAIHttpFailure,
  classifyOpenAINetworkFailure,
} from './openaiErrorClassification.js'
import { sanitizeSchemaForOpenAICompat } from '../../utils/schemaSanitizer.js'
import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import { redactSecretValueForDisplay } from '../../utils/providerProfile.js'
import { shouldRedactUrlQueryParam } from '../../utils/urlRedaction.js'
import {
  normalizeToolArguments,
  hasToolFieldMapping,
} from './toolArgumentNormalization.js'
import { logApiCallStart, logApiCallEnd } from '../../utils/requestLogging.js'
import {
  createStreamState,
  processStreamChunk,
  getStreamStats,
} from '../../utils/streamingOptimizer.js'
import { stableStringifyJson } from '../../utils/stableStringify.js'
import { getVerbooCodeUserAgent } from '../../utils/userAgent.js'
import { updateRouterRateLimitFromHeaders } from '../routerRateLimit.js'
import {
  hasInvalidUnicodeScalar,
  hasInvalidUnicodeScalarDeep,
  resolveStreamedToolName,
} from './openaiProtocolReliability.js'
import {
  BoundedResponseBodyError,
  drainBoundedResponseBody,
  readBoundedResponseJson,
  readBoundedResponseText,
} from './boundedResponseBody.js'

type SecretValueSource = Partial<{
  OPENAI_API_KEY: string
  OPENAI_AUTH_HEADER_VALUE: string
  CODEX_API_KEY: string
  GEMINI_API_KEY: string
  GOOGLE_API_KEY: string
  GEMINI_ACCESS_TOKEN: string
  MISTRAL_API_KEY: string
}>

const GITHUB_429_MAX_RETRIES = 3
const GITHUB_429_BASE_DELAY_SEC = 1
const GITHUB_429_MAX_DELAY_SEC = 32
const GEMINI_API_HOST = 'generativelanguage.googleapis.com'
const VERBOO_SESSION_HEADER = 'X-Verboo-Session-Id'
const VERBOO_REQUEST_ID_HEADER = 'x-verboo-request-id'

type ClientDiagnosticStage =
  | 'client_decode'
  | 'client_parse'
  | 'client_semantic'
  | 'client_render'
type ClientDiagnosticReason =
  | 'invalid_utf8'
  | 'invalid_json'
  | 'invalid_sse_json'
  | 'missing_terminal'
  | 'post_terminal_output'
  | 'tool_name_unique_prefix'
  | 'tool_name_unmatched'
  | 'tool_arguments_invalid'
  | 'resource_limit_exceeded'
  | 'invalid_unicode_scalar'
type ClientDiagnosticReporter = (
  stage: ClientDiagnosticStage,
  reason: ClientDiagnosticReason,
) => void

const clientDiagnosticReporters = new WeakMap<
  Response,
  ClientDiagnosticReporter
>()

const MAX_NON_STREAM_RESPONSE_BODY_BYTES = 8 * 1024 * 1024
const MAX_PROVIDER_ERROR_BODY_BYTES = 1024 * 1024

function reportBoundedResponseFailure(
  response: Response,
  error: unknown,
): void {
  if (!(error instanceof BoundedResponseBodyError)) return
  const report = clientDiagnosticReporters.get(response)
  if (error.failure === 'invalid_utf8') {
    report?.('client_decode', 'invalid_utf8')
  } else if (error.failure === 'invalid_json') {
    report?.('client_parse', 'invalid_json')
  } else if (error.failure === 'too_large') {
    report?.('client_decode', 'resource_limit_exceeded')
  }
}

async function readSuccessfulResponseJson<T>(response: Response): Promise<T> {
  try {
    return await readBoundedResponseJson<T>(
      response,
      MAX_NON_STREAM_RESPONSE_BODY_BYTES,
    )
  } catch (error) {
    reportBoundedResponseFailure(response, error)
    throw error
  }
}

async function readSuccessfulResponseText(response: Response): Promise<string> {
  try {
    return await readBoundedResponseText(
      response,
      MAX_NON_STREAM_RESPONSE_BODY_BYTES,
    )
  } catch (error) {
    reportBoundedResponseFailure(response, error)
    throw error
  }
}

async function readProviderErrorBody(response: Response): Promise<string> {
  try {
    return await readBoundedResponseText(
      response,
      MAX_PROVIDER_ERROR_BODY_BYTES,
    )
  } catch (error) {
    if (error instanceof BoundedResponseBodyError) {
      return `[provider error body ${error.failure}]`
    }
    return '[provider error body unreadable]'
  }
}

function registerClientDiagnosticReporter(
  response: Response,
  baseUrl: string,
  requestHeaders: Readonly<Record<string, string>>,
): void {
  if (!isVerbooRouterUrl(baseUrl)) return
  const requestId = response.headers.get(VERBOO_REQUEST_ID_HEADER)?.trim() ?? ''
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  ) {
    return
  }
  const authorization = Object.entries(requestHeaders).find(
    ([name]) => name.toLowerCase() === 'authorization',
  )?.[1]
  if (!authorization) return
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/client-diagnostics/protocol`
  const sent = new Set<string>()
  clientDiagnosticReporters.set(response, (stage, reason) => {
    const dedupeKey = `${stage}:${reason}`
    if (sent.has(dedupeKey)) return
    sent.add(dedupeKey)
    const diagnosticTimeout = createCombinedAbortSignal(undefined, {
      timeoutMs: 3000,
    })
    void fetchWithProxyRetry(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
        'User-Agent': getVerbooCodeUserAgent(),
      },
      body: JSON.stringify({ requestId, stage, reason }),
      signal: diagnosticTimeout.signal,
    }).then(
      diagnosticResponse => {
        void diagnosticResponse.body?.cancel().catch(() => {})
      },
      () => undefined,
    ).finally(diagnosticTimeout.cleanup)
  })
}
const COPILOT_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'Editor-Version': 'vscode/1.99.3',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
}

function isGithubModelsMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
}

function filterAnthropicHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {}

  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (
      lower.startsWith('x-anthropic') ||
      lower.startsWith('anthropic-') ||
      lower.startsWith('x-claude') ||
      lower.startsWith('x-verboo') ||
      lower === 'x-app' ||
      lower === 'x-client-app' ||
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower === 'api-key'
    ) {
      continue
    }
    filtered[key] = value
  }

  return filtered
}

function normalizeBaseUrlForComparison(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').toLowerCase()
}

function isVerbooRouterUrl(baseUrl: string): boolean {
  return (
    normalizeBaseUrlForComparison(baseUrl) ===
    normalizeBaseUrlForComparison(VERBOO_ROUTER_URL)
  )
}

function hasGeminiApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    return new URL(baseUrl).hostname.toLowerCase() === GEMINI_API_HOST
  } catch {
    return false
  }
}

function hasCerebrasApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.cerebras.ai' || host.endsWith('.cerebras.ai')
  } catch {
    return false
  }
}

function normalizeDeepSeekReasoningEffort(
  effort: 'low' | 'medium' | 'high' | 'xhigh',
): 'high' | 'max' {
  return effort === 'xhigh' ? 'max' : 'high'
}

function formatRetryAfterHint(response: Response): string {
  const ra = response.headers.get('retry-after')
  return ra ? ` (Retry-After: ${ra})` : ''
}

function redactUrlForDiagnostics(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username) {
      parsed.username = 'redacted'
    }
    if (parsed.password) {
      parsed.password = 'redacted'
    }

    for (const key of parsed.searchParams.keys()) {
      if (shouldRedactUrlQueryParam(key)) {
        parsed.searchParams.set(key, 'redacted')
      }
    }

    const serialized = parsed.toString()
    return (
      redactSecretValueForDisplay(
        serialized,
        process.env as SecretValueSource,
      ) ?? serialized
    )
  } catch {
    return (
      redactSecretValueForDisplay(url, process.env as SecretValueSource) ?? url
    )
  }
}

function redactUrlsInMessage(message: string): string {
  return message.replace(/https?:\/\/\S+/g, (match) =>
    redactUrlForDiagnostics(match),
  )
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function captureRouterRateLimit(
  headers: globalThis.Headers,
  sourceUrl: string,
): void {
  updateRouterRateLimitFromHeaders(headers, { sourceUrl })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function buildResponseFormatFromOutputConfig(
  params: ShimCreateParams,
): Record<string, unknown> | undefined {
  const outputConfig = params.output_config
  if (!isRecord(outputConfig)) return undefined

  const format = outputConfig.format
  if (!isRecord(format)) return undefined

  if (format.type === 'json_object') {
    return { type: 'json_object' }
  }

  if (format.type !== 'json_schema' || !isRecord(format.schema)) {
    return undefined
  }

  const name =
    typeof format.name === 'string' && format.name.trim()
      ? format.name.trim()
      : 'structured_output'
  const strict = typeof format.strict === 'boolean' ? format.strict : true

  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict,
      schema: sanitizeSchemaForOpenAICompat(format.schema),
    },
  }
}

// ---------------------------------------------------------------------------
// Types — minimal subset of Anthropic SDK types we need to produce
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Message format conversion: Anthropic → OpenAI
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?:
    string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
    extra_content?: Record<string, unknown>
  }>
  tool_call_id?: string
  name?: string
  /**
   * Per-assistant-message chain-of-thought, attached when echoing an
   * assistant message back to providers that require it (notably Moonshot:
   * "thinking is enabled but reasoning_content is missing in assistant
   * tool call message at index N" 400). Derived from the Anthropic thinking
   * block captured when the original response was translated.
   */
  reasoning_content?: string
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

function convertSystemPrompt(system: unknown): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return (
      system
        .map((block: { type?: string; text?: string }) =>
          block.type === 'text' ? (block.text ?? '') : '',
        )
        // Drop the Anthropic billing/attribution block — it's only meaningful to
        // Anthropic's `_parse_cc_header` and is dead weight (plus a churning
        // per-build fingerprint that busts prefix KV cache) for OpenAI-compat
        // providers like local Ollama / llama.cpp / Codex pass-throughs.
        .filter((text) => !text.startsWith('x-anthropic-billing-header'))
        .join('\n\n')
    )
  }
  return String(system)
}

function convertToolResultContent(
  content: unknown,
  isError?: boolean,
):
  string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (typeof content === 'string') {
    return isError ? `Error: ${content}` : content
  }
  if (!Array.isArray(content)) {
    const text = JSON.stringify(content ?? '')
    return isError ? `Error: ${text}` : text
  }

  const parts: Array<{
    type: string
    text?: string
    image_url?: { url: string }
  }> = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
      continue
    }

    if (block?.type === 'image') {
      const source = block.source
      if (source?.type === 'url' && source.url) {
        parts.push({ type: 'image_url', image_url: { url: source.url } })
      } else if (
        source?.type === 'base64' &&
        source.media_type &&
        source.data
      ) {
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${source.media_type};base64,${source.data}`,
          },
        })
      }
      continue
    }

    if (typeof block?.text === 'string') {
      parts.push({ type: 'text', text: block.text })
    }
  }

  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0].type === 'text') {
    const text = parts[0].text ?? ''
    return isError ? `Error: ${text}` : text
  }

  // Collapse arrays of only text blocks into a single string for DeepSeek
  // compatibility (issue #774). DeepSeek rejects arrays in role: "tool" messages.
  const allText = parts.every((p) => p.type === 'text')
  if (allText) {
    const text = parts.map((p) => p.text ?? '').join('\n\n')
    return isError ? `Error: ${text}` : text
  }

  if (isError && parts[0]?.type === 'text') {
    parts[0] = { ...parts[0], text: `Error: ${parts[0].text ?? ''}` }
  } else if (isError) {
    parts.unshift({ type: 'text', text: 'Error:' })
  }

  return parts
}

function convertContentBlocks(
  content: unknown,
):
  string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts: Array<{
    type: string
    text?: string
    image_url?: { url: string }
  }> = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text ?? '' })
        break
      case 'image': {
        const src = block.source
        if (src?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${src.media_type};base64,${src.data}`,
            },
          })
        } else if (src?.type === 'url') {
          parts.push({ type: 'image_url', image_url: { url: src.url } })
        }
        break
      }
      case 'tool_use':
        // handled separately
        break
      case 'tool_result':
        // handled separately
        break
      case 'thinking':
      case 'redacted_thinking':
        // Strip thinking blocks for OpenAI-compatible providers.
        // These are Anthropic-specific content types that 3P providers
        // don't understand. Serializing them as <thinking> text corrupts
        // multi-turn context: the model sees the tags as part of its
        // previous reply and may mimic or misattribute them.
        break
      default:
        if (block.text) {
          parts.push({ type: 'text', text: block.text })
        }
    }
  }

  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text ?? ''

  // Collapse arrays of only text blocks into a single string for DeepSeek
  // compatibility (issue #774).
  const allText = parts.every((p) => p.type === 'text')
  if (allText) {
    return parts.map((p) => p.text ?? '').join('\n\n')
  }

  return parts
}

function isGeminiMode(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI) ||
    hasGeminiApiHost(process.env.OPENAI_BASE_URL)
  )
}

function hydrateOpenAIShimCompatibilityEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): void {
  // Provider selection, base URL defaults, and model defaults now flow
  // through resolveProviderRequest(). The shim still needs a few legacy
  // credential aliases because downstream auth/header paths read OPENAI_*.
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GEMINI)) {
    const geminiApiKey = processEnv.GEMINI_API_KEY ?? processEnv.GOOGLE_API_KEY
    if (geminiApiKey && !processEnv.OPENAI_API_KEY) {
      processEnv.OPENAI_API_KEY = geminiApiKey
    }
    return
  }

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_MISTRAL)) {
    if (processEnv.MISTRAL_API_KEY && !processEnv.OPENAI_API_KEY) {
      processEnv.OPENAI_API_KEY = processEnv.MISTRAL_API_KEY
    }
    return
  }

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GITHUB)) {
    processEnv.OPENAI_API_KEY ??=
      processEnv.GITHUB_TOKEN ?? processEnv.GH_TOKEN ?? ''
    return
  }

  if (processEnv.BANKR_BASE_URL && !processEnv.OPENAI_BASE_URL) {
    processEnv.OPENAI_BASE_URL = processEnv.BANKR_BASE_URL
  }
  if (processEnv.BANKR_MODEL && !processEnv.OPENAI_MODEL) {
    processEnv.OPENAI_MODEL = processEnv.BANKR_MODEL
  }

  const routeCredential = resolveRouteCredentialValue({
    processEnv,
    baseUrl: processEnv.OPENAI_BASE_URL ?? processEnv.OPENAI_API_BASE,
  })
  if (routeCredential && !processEnv.OPENAI_API_KEY) {
    processEnv.OPENAI_API_KEY = routeCredential
  }
}

function convertMessages(
  messages: Array<{
    role: string
    message?: { role?: string; content?: unknown }
    content?: unknown
  }>,
  system: unknown,
  options?: {
    preserveReasoningContent?: boolean
    reasoningContentFallback?: '' | 'omit'
  },
): OpenAIMessage[] {
  const preserveReasoningContent = options?.preserveReasoningContent === true
  const reasoningContentFallback = options?.reasoningContentFallback
  const result: OpenAIMessage[] = []
  const knownToolCallIds = new Set<string>()

  // Pre-scan for all tool results in the history to identify valid tool calls
  const toolResultIds = new Set<string>()
  for (const msg of messages) {
    const inner = msg.message ?? msg
    const content = (inner as { content?: unknown }).content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          (block as { type?: string }).type === 'tool_result' &&
          (block as { tool_use_id?: string }).tool_use_id
        ) {
          toolResultIds.add((block as { tool_use_id: string }).tool_use_id)
        }
      }
    }
  }

  // System message first
  const sysText = convertSystemPrompt(system)
  if (sysText) {
    result.push({ role: 'system', content: sysText })
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const isLastInHistory = i === messages.length - 1

    // Claude Code wraps messages in { role, message: { role, content } }
    const inner = msg.message ?? msg
    const role = (inner as { role?: string }).role ?? msg.role
    const content = (inner as { content?: unknown }).content

    if (role === 'user') {
      // Check for tool_result blocks in user messages
      if (Array.isArray(content)) {
        const toolResults = content.filter(
          (b: { type?: string }) => b.type === 'tool_result',
        )
        const otherContent = content.filter(
          (b: { type?: string }) => b.type !== 'tool_result',
        )

        // Emit tool results as tool messages, but ONLY if we have a matching tool_use ID.
        // Mistral/OpenAI strictly require tool messages to follow an assistant message with tool_calls.
        // If the user interrupted (ESC) and a synthetic tool_result was generated without a recorded tool_use,
        // emitting it here would cause a "role must alternate" or "unexpected role" error.
        for (const tr of toolResults) {
          const id = tr.tool_use_id ?? 'unknown'
          if (knownToolCallIds.has(id)) {
            result.push({
              role: 'tool',
              tool_call_id: id,
              content: convertToolResultContent(tr.content, tr.is_error),
            })
          } else {
            logForDebugging(
              `Dropping orphan tool_result for ID: ${id} to prevent API error`,
            )
          }
        }

        // Emit remaining user content
        if (otherContent.length > 0) {
          result.push({
            role: 'user',
            content: convertContentBlocks(otherContent),
          })
        }
      } else {
        result.push({
          role: 'user',
          content: convertContentBlocks(content),
        })
      }
    } else if (role === 'assistant') {
      // Check for tool_use blocks
      if (Array.isArray(content)) {
        const toolUses = content.filter(
          (b: { type?: string }) => b.type === 'tool_use',
        )
        const thinkingBlock = content.find(
          (b: { type?: string }) => b.type === 'thinking',
        )
        const textContent = content.filter(
          (b: { type?: string }) =>
            b.type !== 'tool_use' && b.type !== 'thinking',
        )

        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: (() => {
            const c = convertContentBlocks(textContent)
            return typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? c.map((p: { text?: string }) => p.text ?? '').join('')
                : ''
          })(),
        }

        // Providers that validate reasoning continuity (Moonshot/Kimi Code: "thinking
        // is enabled but reasoning_content is missing in assistant tool call
        // message at index N" 400) need the original chain-of-thought echoed
        // back on each assistant message that carries a tool_call. We kept
        // the thinking block on the Anthropic side; re-attach it here as the
        // `reasoning_content` field on the outgoing OpenAI-shaped message.
        // Gated per-provider because other endpoints either ignore the field
        // (harmless) or strict-reject unknown fields (harmful).
        if (preserveReasoningContent) {
          const thinkingText = (
            thinkingBlock as { thinking?: string } | undefined
          )?.thinking
          if (
            typeof thinkingText === 'string' &&
            thinkingText.trim().length > 0
          ) {
            assistantMsg.reasoning_content = thinkingText
          } else if (toolUses.length > 0 && reasoningContentFallback === '') {
            assistantMsg.reasoning_content = ''
          }
        }

        if (toolUses.length > 0) {
          const mappedToolCalls = toolUses
            .map(
              (tu: {
                id?: string
                name?: string
                input?: unknown
                extra_content?: Record<string, unknown>
                signature?: string
              }) => {
                const id = tu.id ?? `call_${randomUUID().replace(/-/g, '')}`

                // Only keep tool calls that have a corresponding result in the history,
                // or if it's the last message (prefill scenario).
                // Orphaned tool calls (e.g. from user interruption) cause 400 errors.
                if (!toolResultIds.has(id) && !isLastInHistory) {
                  return null
                }

                knownToolCallIds.add(id)
                const toolCall: NonNullable<
                  OpenAIMessage['tool_calls']
                >[number] = {
                  id,
                  type: 'function' as const,
                  function: {
                    name: tu.name ?? 'unknown',
                    arguments:
                      typeof tu.input === 'string'
                        ? tu.input
                        : JSON.stringify(tu.input ?? {}),
                  },
                }

                // Preserve existing extra_content if present
                if (tu.extra_content) {
                  toolCall.extra_content = { ...tu.extra_content }
                }

                // Handle Gemini thought_signature
                if (isGeminiMode()) {
                  // If the model provided a signature in the tool_use block itself (e.g. from a previous Turn/Step)
                  // Use thinkingBlock.signature for ALL tool calls in the same assistant turn if available.
                  // The API requires the same signature on every replayed function call part in a parallel set.
                  const signature =
                    tu.signature ?? (thinkingBlock as any)?.signature

                  // Merge into existing google-specific metadata if present
                  const existingGoogle =
                    (toolCall.extra_content?.google as Record<
                      string,
                      unknown
                    >) ?? {}
                  toolCall.extra_content = {
                    ...toolCall.extra_content,
                    google: {
                      ...existingGoogle,
                      // Prefer explicit signature, then fall back to already-captured
                      // thought_signature (from extra_content preserved in messages.ts)
                      thought_signature:
                        signature ??
                        (existingGoogle.thought_signature as
                          string | undefined) ??
                        'skip_thought_signature_validator',
                    },
                  }
                }

                return toolCall
              },
            )
            .filter((tc): tc is NonNullable<typeof tc> => tc !== null)

          if (mappedToolCalls.length > 0) {
            assistantMsg.tool_calls = mappedToolCalls
          }
        }

        // Only push assistant message if it has content or tool calls.
        // Stripped thinking-only blocks from user interruptions are empty and cause 400s.
        if (assistantMsg.content || assistantMsg.tool_calls?.length) {
          result.push(assistantMsg)
        }
      } else {
        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: (() => {
            const c = convertContentBlocks(content)
            return typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? c.map((p: { text?: string }) => p.text ?? '').join('')
                : ''
          })(),
        }

        if (assistantMsg.content) {
          result.push(assistantMsg)
        }
      }
    }
  }

  // Coalescing pass: merge consecutive messages of the same role.
  // OpenAI/vLLM/Ollama require strict user↔assistant alternation.
  // Multiple consecutive tool messages are allowed (assistant → tool* → user).
  // Consecutive user or assistant messages must be merged to avoid Jinja
  // template errors like "roles must alternate" (Devstral, Mistral models).
  const coalesced: OpenAIMessage[] = []
  for (const msg of result) {
    const prev = coalesced[coalesced.length - 1]

    // Mistral/Devstral: 'tool' message must be followed by an 'assistant' message.
    // If a completed tool result is followed by a new user message, inject a
    // neutral acknowledgement to satisfy the strict role sequence. Do not call
    // this an interruption: this transition also occurs after normal tool runs.
    // ... -> assistant (calls) -> tool (results) -> assistant (semantic) -> user (next)
    if (prev && prev.role === 'tool' && msg.role === 'user') {
      coalesced.push({
        role: 'assistant',
        content: 'Tool result received. Continuing with the next request.',
      })
    }

    const lastAfterPossibleInjection = coalesced[coalesced.length - 1]
    if (
      lastAfterPossibleInjection &&
      lastAfterPossibleInjection.role === msg.role &&
      msg.role !== 'tool' &&
      msg.role !== 'system'
    ) {
      const prevContent = lastAfterPossibleInjection.content
      const curContent = msg.content

      if (typeof prevContent === 'string' && typeof curContent === 'string') {
        lastAfterPossibleInjection.content =
          prevContent + (prevContent && curContent ? '\n' : '') + curContent
      } else {
        const toArray = (
          c:
            | string
            | Array<{
                type: string
                text?: string
                image_url?: { url: string }
              }>
            | undefined,
        ): Array<{
          type: string
          text?: string
          image_url?: { url: string }
        }> => {
          if (!c) return []
          if (typeof c === 'string') return c ? [{ type: 'text', text: c }] : []
          return c
        }
        lastAfterPossibleInjection.content = [
          ...toArray(prevContent),
          ...toArray(curContent),
        ]
      }

      if (msg.tool_calls?.length) {
        lastAfterPossibleInjection.tool_calls = [
          ...(lastAfterPossibleInjection.tool_calls ?? []),
          ...msg.tool_calls,
        ]
      }
    } else {
      coalesced.push(msg)
    }
  }

  return coalesced
}

/**
 * OpenAI requires every key in `properties` to also appear in `required`.
 * Anthropic schemas often mark fields as optional (omitted from `required`),
 * which causes 400 errors on OpenAI/Codex endpoints. This normalizes the
 * schema by ensuring `required` is a superset of `properties` keys.
 */
function normalizeSchemaForOpenAI(
  schema: Record<string, unknown>,
  strict = true,
): Record<string, unknown> {
  const record = sanitizeSchemaForOpenAICompat(schema)

  if (record.type === 'object' && record.properties) {
    const properties = record.properties as Record<
      string,
      Record<string, unknown>
    >
    const existingRequired = Array.isArray(record.required)
      ? (record.required as string[])
      : []

    // Recurse into each property
    const normalizedProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties)) {
      normalizedProps[key] = normalizeSchemaForOpenAI(
        value as Record<string, unknown>,
        strict,
      )
    }
    record.properties = normalizedProps

    if (strict) {
      // Keep only the properties that were originally marked required in the schema.
      // Adding every property to required[] (the previous behaviour) caused strict
      // OpenAI-compatible providers (Groq, Azure, etc.) to reject tool calls because
      // the model correctly omits optional arguments — but the provider treats them
      // as missing required fields and returns a 400 / tool_use_failed error.
      record.required = existingRequired.filter((k) => k in normalizedProps)
      // additionalProperties: false is still required by strict-mode providers.
      record.additionalProperties = false
    } else {
      // For Gemini: keep only existing required keys that are present in properties
      record.required = existingRequired.filter((k) => k in normalizedProps)
    }
  }

  // Recurse into array items
  if ('items' in record) {
    if (Array.isArray(record.items)) {
      record.items = (record.items as unknown[]).map((item) =>
        normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    } else {
      record.items = normalizeSchemaForOpenAI(
        record.items as Record<string, unknown>,
        strict,
      )
    }
  }

  // Recurse into combinators
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (key in record && Array.isArray(record[key])) {
      record[key] = (record[key] as unknown[]).map((item) =>
        normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    }
  }

  return record
}

function convertTools(
  tools: Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
  }>,
  options: { skipStrict?: boolean } = {},
): OpenAITool[] {
  const isGemini = isGeminiMode()
  // VERBOO-BRAND: dual-read env var (VERBOO_* canonical, OPENCLAUDE_* alias)
  const strict =
    !isGemini &&
    !isEnvTruthy(
      process.env.VERBOO_DISABLE_STRICT_TOOLS ??
        process.env.OPENCLAUDE_DISABLE_STRICT_TOOLS,
    ) &&
    !options.skipStrict

  return tools
    .filter((t) => t.name !== 'ToolSearchTool') // Not relevant for OpenAI
    .map((t) => {
      const schema = {
        ...(t.input_schema ?? { type: 'object', properties: {} }),
      } as Record<string, unknown>

      // For Codex/OpenAI: promote known Agent sub-fields into required[] only if
      // they actually exist in properties (Gemini rejects required keys absent from properties).
      if (t.name === 'Agent' && schema.properties) {
        const props = schema.properties as Record<string, unknown>
        if (!Array.isArray(schema.required)) schema.required = []
        const req = schema.required as string[]
        for (const key of ['message', 'subagent_type']) {
          if (key in props && !req.includes(key)) req.push(key)
        }
      }

      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: normalizeSchemaForOpenAI(schema, strict),
        },
      }
    })
}

// ---------------------------------------------------------------------------
// Streaming: OpenAI SSE → Anthropic stream events
// ---------------------------------------------------------------------------

interface OpenAIStreamChunk {
  id: string
  object: string
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      function_call?: { name?: string; arguments?: string }
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
        extra_content?: Record<string, unknown>
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
}

type OpenAIStreamToolCallDelta = NonNullable<
  OpenAIStreamChunk['choices'][number]['delta']['tool_calls']
>[number]

function makeMessageId(): string {
  return `msg_${randomUUID().replace(/-/g, '')}`
}

// Normalization fills absent fields with zero for legacy consumers. Preserve
// presence separately so live agent counters never mistake absence for a report.
function usagePresence(raw: unknown) {
  const value = (raw ?? {}) as Record<string, unknown>
  const valid = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  return {
    ...(!valid(value.prompt_tokens) && !valid(value.input_tokens) && { usageInputReported: false }),
    ...(!valid(value.completion_tokens) && !valid(value.output_tokens) && { usageOutputReported: false }),
  }
}

function convertChunkUsage(
  usage: OpenAIStreamChunk['usage'] | undefined,
): Partial<AnthropicUsage> | undefined {
  if (!usage) return undefined
  // Delegates to the shared helper so this path, codexShim.makeUsage,
  // the non-streaming response below, and the integration tests all
  // produce byte-identical output for the same raw input.
  return buildAnthropicUsageFromRawUsage(
    usage as unknown as Record<string, unknown>,
  )
}

function hasInvalidToolArguments(
  raw: string,
  toolName: string,
): boolean {
  if (toolArgumentsContainInvalidUnicode(raw)) return true
  const trimmed = raw.trim()
  if (!hasToolFieldMapping(toolName)) {
    try {
      const parsed = JSON.parse(raw)
      return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    } catch {
      return true
    }
  }

  if (!trimmed.startsWith('{')) return false
  try {
    JSON.parse(raw)
    return false
  } catch {
    // Keep the long-standing Bash compatibility for complete compound
    // commands such as `{ pwd; }`. Every other brace-prefixed malformed value
    // is treated as a broken JSON object and must never be repaired/executed.
    return !(
      toolName.toLowerCase() === 'bash' &&
      /^\{\s*[^{}]*;\s*\}$/.test(trimmed)
    )
  }
}

function toolArgumentsContainInvalidUnicode(raw: string): boolean {
  if (hasInvalidUnicodeScalar(raw)) return true
  try {
    return hasInvalidUnicodeScalarDeep(JSON.parse(raw))
  } catch {
    return false
  }
}

// Terminal-only commit requires buffering provider fragments. Keep a generous
// hard ceiling so a broken or hostile stream cannot grow the CLI heap without
// bound before it ever produces a valid terminal event.
const DEFAULT_MAX_BUFFERED_TOOL_ARGUMENT_CHARS = 8 * 1024 * 1024
const HARD_MAX_BUFFERED_TOOL_ARGUMENT_CHARS = 8 * 1024 * 1024
const MAX_ACTIVE_TOOL_CALLS = 128
const MAX_TOOL_ID_OR_NAME_FRAGMENT_CHARS = 512
const MAX_TOOL_IDENTITY_CHARS_PER_CALL = 4096
const MAX_BUFFERED_TOOL_IDENTITY_CHARS = 256 * 1024
const MAX_SSE_LINE_BUFFER_CHARS = 4 * 1024 * 1024
const MAX_SSE_READ_CHUNK_BYTES = 8 * 1024 * 1024
const MAX_OPENAI_RENDERABLE_TEXT_CHARS = 8 * 1024 * 1024
const MAX_OPAQUE_TOOL_METADATA_CHARS_PER_CALL = 1024 * 1024
const MAX_BUFFERED_OPAQUE_TOOL_METADATA_CHARS = 2 * 1024 * 1024
const MAX_OPAQUE_TOOL_METADATA_DEPTH = 32

function maxBufferedToolArgumentChars(): number {
  const raw = process.env.VERBOO_MAX_BUFFERED_TOOL_ARGUMENT_CHARS
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, HARD_MAX_BUFFERED_TOOL_ARGUMENT_CHARS)
    : DEFAULT_MAX_BUFFERED_TOOL_ARGUMENT_CHARS
}

function mergeOpaqueMetadata(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
	depth = 0,
): Record<string, unknown> {
	if (depth >= MAX_OPAQUE_TOOL_METADATA_DEPTH) {
	  throw new Error('opaque tool metadata exceeded nesting limit')
	}
  const merged = Object.fromEntries(
    Object.entries(current ?? {}),
  ) as Record<string, unknown>
  for (const [key, nextValue] of Object.entries(next)) {
    const currentValue = merged[key]
    if (
      currentValue !== null &&
      nextValue !== null &&
      typeof currentValue === 'object' &&
      typeof nextValue === 'object' &&
      !Array.isArray(currentValue) &&
      !Array.isArray(nextValue)
    ) {
      Object.defineProperty(merged, key, {
        value: mergeOpaqueMetadata(
          currentValue as Record<string, unknown>,
          nextValue as Record<string, unknown>,
		  depth + 1,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    } else {
      Object.defineProperty(merged, key, {
        value: nextValue,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  }
  return merged
}

type ActiveOpenAIToolCall = {
  id: string
  name: string
  idFragments: string[]
  nameFragments: string[]
  identityChars: number
  index: number | null
  jsonBuffer: string
  ambiguousArgumentFraming: boolean
  emittedJsonLength: number
  normalizeAtStop: boolean
  hasStarted: boolean
  hasStopped: boolean
  extra_content?: Record<string, unknown>
  extraContentChars: number
}

function getAdvertisedToolResolution(params: ShimCreateParams): {
  names: string[]
  recoverableNames: string[]
} {
  const tools = (params.tools ?? []).filter(
    tool =>
      typeof tool.name === 'string' &&
      tool.name &&
      tool.name !== 'ToolSearchTool',
  )
  return {
    names: tools.map(tool => tool.name as string),
    recoverableNames: tools.flatMap(tool =>
      (tool as unknown as Record<PropertyKey, unknown>)[
        TOOL_NAME_PREFIX_RECOVERY_ALLOWED
      ] === true
        ? [tool.name as string]
        : [],
    ),
  }
}

/**
 * Async generator that transforms an OpenAI SSE stream into
 * Anthropic-format BetaRawMessageStreamEvent objects.
 */
// Module-level handler para sinalizar status do router upstream (ex.: vast.ai
// warming-up durante cold start). Definido pelo QueryEngine antes de cada query
// e limpo no fim. Module-level (não per-instance) porque o cliente é criado
// uma vez por sessão mas setSDKStatus muda a cada query.
let routerStatusHandler: ((status: 'warming-up' | null) => void) | null = null
let routerStatusHandlerGeneration = 0
const activeWarmingHints = new Set<symbol>()

export function setOpenAIShimRouterStatusHandler(
  fn: ((status: 'warming-up' | null) => void) | null,
): void {
  if (routerStatusHandler && activeWarmingHints.size > 0) {
    routerStatusHandler(null)
  }
  activeWarmingHints.clear()
  routerStatusHandlerGeneration++
  routerStatusHandler = fn
}

// -----------------------------------------------------------------------------
// Aviso "preparando o modelo" (warming hint) por TEMPO.
// Cobre a latência de cauda (cold start / preempção do backend) que NÃO vem
// acompanhada do sinal router_status:"warming". O cronômetro começa no ENVIO
// da requisição (em `create`), então pega tanto o caso do corpo lento quanto o
// da requisição inteira pendurada antes de qualquer resposta. É só comunicação
// visual — nunca aborta nem interfere no resultado. Override: VERBOO_SLOW_HINT_MS.

function getSlowHintMs(): number {
  const raw = process.env.VERBOO_SLOW_HINT_MS
  const v = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(v) && v > 0 ? v : 12_000
}

type WarmingHintController = {
  schedule: (delayMs: number) => void
  showNow: () => void
  resolve: () => void
}

/**
 * One controller per request. The module-level set only aggregates visible
 * hints so one completed request cannot clear another concurrent slow request.
 */
function createWarmingHintController(
  signal?: AbortSignal,
): WarmingHintController {
  const token = Symbol('warming-hint')
  const handlerGeneration = routerStatusHandlerGeneration
  let timer: ReturnType<typeof setTimeout> | null = null
  let shown = false
  let resolved = false

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const showNow = () => {
    clearTimer()
    if (
      resolved ||
      shown ||
      handlerGeneration !== routerStatusHandlerGeneration ||
      !routerStatusHandler
    ) {
      return
    }
    shown = true
    const wasEmpty = activeWarmingHints.size === 0
    activeWarmingHints.add(token)
    if (wasEmpty) routerStatusHandler('warming-up')
  }

  const resolve = () => {
    if (resolved) return
    resolved = true
    clearTimer()
    signal?.removeEventListener('abort', resolve)
    if (!shown) return

    activeWarmingHints.delete(token)
    if (
      activeWarmingHints.size === 0 &&
      handlerGeneration === routerStatusHandlerGeneration
    ) {
      routerStatusHandler?.(null)
    }
  }

  const schedule = (delayMs: number) => {
    if (resolved) return
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      showNow()
    }, delayMs)
  }

  if (signal?.aborted) {
    resolved = true
  } else {
    signal?.addEventListener('abort', resolve, { once: true })
  }

  return { schedule, showNow, resolve }
}

async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
  warmingHint?: WarmingHintController,
  advertisedToolNames: readonly string[] = [],
  recoverableToolNames: readonly string[] = [],
  reportDiagnostic?: ClientDiagnosticReporter,
): AsyncGenerator<AnthropicStreamEvent> {
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  const activeToolCalls = new Map<number, ActiveOpenAIToolCall>()
  let hasEmittedContentStart = false
  let hasEmittedThinkingStart = false
  let hasClosedThinking = false
  const thinkFilter = createThinkTagFilter()
  let lastStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | null = null
  let hasEmittedFinalUsage = false
  let hasProcessedFinishReason = false
  let sawDoneMarker = false
  const streamState = createStreamState()
  let nextSyntheticProtocolIndex = -2
  let totalBufferedToolArgumentChars = 0
  let totalBufferedToolIdentityChars = 0
	let totalBufferedOpaqueToolMetadataChars = 0
  let emittedRenderableTextChars = 0
  const toolArgumentCharsLimit = maxBufferedToolArgumentChars()

  const requireRenderableUnicode = (value: string): void => {
    if (!hasInvalidUnicodeScalar(value)) return
    reportDiagnostic?.('client_render', 'invalid_unicode_scalar')
    throw new Error(
      'Upstream text contained an invalid Unicode scalar; the corrupted text was not rendered.',
    )
  }

  const reserveRenderableText = (value: string): void => {
    if (
      emittedRenderableTextChars + value.length >
      MAX_OPENAI_RENDERABLE_TEXT_CHARS
    ) {
      reportDiagnostic?.('client_render', 'resource_limit_exceeded')
      throw new Error(
        'Upstream text exceeded the client rendering safety limit; the remaining output was not rendered.',
      )
    }
    emittedRenderableTextChars += value.length
  }

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usageReported: false,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }

  const responseBody = response.body
  if (!responseBody) {
    throw new Error('Upstream SSE response had no readable body')
  }
  const reader = responseBody.getReader()
  type ReaderResult = Awaited<ReturnType<typeof reader.read>>

  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  // Default raised from 2min to 10min: long Qwen reasoning runs under vLLM
  // scheduler preemption can pause minutes between chunks even when healthy.
  // Override via VERBOO_STREAM_IDLE_TIMEOUT_MS for diagnosis.
  const STREAM_IDLE_TIMEOUT_MS = (() => {
    const raw = process.env.VERBOO_STREAM_IDLE_TIMEOUT_MS
    const v = raw ? parseInt(raw, 10) : NaN
    return Number.isFinite(v) && v > 0 ? v : 600_000
  })()
  // After [DONE], compliant streams close immediately. A short grace read
  // catches coalesced or immediately-following protocol bytes without making
  // a provider that leaves keep-alive open add material latency to every turn.
  const STREAM_TERMINAL_GRACE_MS = 250
  let terminalGraceDeadline: number | undefined
  let pendingDoneEventDelimiter = false
  let lastDataTime = Date.now()
  const streamStartedAt = Date.now()
  let pendingReaderCancellation: Promise<void> | undefined

  const cancelReader = (reason: unknown): void => {
    pendingReaderCancellation = reader.cancel(reason).then(
      () => undefined,
      () => undefined,
    )
  }

  /**
   * Read from the stream with an idle timeout. If no data arrives within
   * STREAM_IDLE_TIMEOUT_MS, assume the connection is dead and throw so
   * withRetry can reconnect. This prevents indefinite hangs on stale
   * SSE connections from OpenAI/Gemini during long-running sessions.
   * Respects the caller's AbortSignal — clears the idle timer on abort
   * so the rejection reason is AbortError, not a spurious idle timeout.
   */
  async function readWithTimeout(
    timeoutMs = STREAM_IDLE_TIMEOUT_MS,
    timeoutCompletesStream = false,
  ): Promise<ReaderResult> {
    return new Promise((resolve, reject) => {
      let settled = false
      let abortCleanup: (() => void) | undefined
      const cleanup = () => {
        clearTimeout(timeoutId)
        if (signal && abortCleanup) {
          signal.removeEventListener('abort', abortCleanup)
        }
      }
      const resolveOnce = (result: ReaderResult) => {
        if (settled) return
        settled = true
        cleanup()
        if (result.value) lastDataTime = Date.now()
        resolve(result)
      }
      const rejectOnce = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const timeoutId = setTimeout(() => {
        const elapsed = Math.round((Date.now() - lastDataTime) / 1000)
        const timeoutError = new Error(
          `OpenAI/Gemini SSE stream idle for ${elapsed}s (limit: ${timeoutMs / 1000}s). Connection likely dropped.`,
        )
        // Cancel the still-pending read so the reader lock can be released and
        // a late chunk cannot outlive this failed request.
        cancelReader(timeoutError)
        if (timeoutCompletesStream) {
          resolveOnce({ done: true, value: undefined })
        } else {
          rejectOnce(timeoutError)
        }
      }, timeoutMs)

      if (signal) {
        abortCleanup = () => {
          const abortError =
            signal.reason instanceof Error
              ? signal.reason
              : Object.assign(new Error('The operation was aborted'), {
                  name: 'AbortError',
                })
          cancelReader(abortError)
          rejectOnce(abortError)
        }
        if (signal.aborted) {
          abortCleanup()
          return
        }
        signal.addEventListener('abort', abortCleanup, { once: true })
      }

      reader.read().then(resolveOnce, rejectOnce)
    })
  }

  const closeActiveContentBlock = async function* () {
    if (!hasEmittedContentStart) return

    const tail = thinkFilter.flush()
    if (tail) {
      reserveRenderableText(tail)
      yield {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: { type: 'text_delta', text: tail },
      }
    }

    yield {
      type: 'content_block_stop',
      index: contentBlockIndex,
    }
    contentBlockIndex++
    hasEmittedContentStart = false
  }

  const finalizeToolCall = (toolCall: ActiveOpenAIToolCall): string | null => {
    const distinctIds = [...new Set(toolCall.idFragments.filter(Boolean))]
    if (distinctIds.length > 1) {
      return 'conflicting_tool_call_ids'
    }
    if (distinctIds.length === 1) toolCall.id = distinctIds[0]!

    const resolvedName = resolveStreamedToolName(
      advertisedToolNames,
      toolCall.nameFragments,
      recoverableToolNames,
    )
    toolCall.name = resolvedName.name
    if (resolvedName.recoveredUniquePrefix) {
      reportDiagnostic?.('client_semantic', 'tool_name_unique_prefix')
    }
    if (resolvedName.ambiguous) {
      reportDiagnostic?.('client_semantic', 'tool_name_unmatched')
      return 'ambiguous_tool_name_fragments'
    }
    if (!toolCall.id.trim()) return 'missing_tool_call_id'
    if (!toolCall.name.trim()) return 'missing_tool_name'
    if (
      hasInvalidUnicodeScalar(toolCall.id) ||
      hasInvalidUnicodeScalar(toolCall.name) ||
      hasInvalidUnicodeScalarDeep(toolCall.extra_content) ||
      toolArgumentsContainInvalidUnicode(toolCall.jsonBuffer)
    ) {
      reportDiagnostic?.('client_semantic', 'invalid_unicode_scalar')
      return 'invalid_tool_protocol_unicode'
    }
    if (toolCall.ambiguousArgumentFraming) {
      reportDiagnostic?.('client_semantic', 'tool_arguments_invalid')
      return 'ambiguous_tool_argument_fragments'
    }
    if (
      hasInvalidToolArguments(
        toolCall.jsonBuffer,
        toolCall.name,
      )
    ) {
      reportDiagnostic?.('client_semantic', 'tool_arguments_invalid')
      return 'malformed_structured_tool_arguments'
    }
    return null
  }

  const startToolCall = async function* (toolCall: ActiveOpenAIToolCall) {
    if (
      toolCall.hasStarted ||
      toolCall.index === null ||
      !toolCall.id ||
      !toolCall.name
    ) return
    const blockIndex = toolCall.index

    toolCall.normalizeAtStop = hasToolFieldMapping(toolCall.name)
    toolCall.hasStarted = true

    yield {
      type: 'content_block_start' as const,
      index: blockIndex,
      content_block: {
        type: 'tool_use' as const,
        id: toolCall.id,
        name: toolCall.name,
        input: {},
        ...(toolCall.extra_content
          ? { extra_content: toolCall.extra_content }
          : {}),
        ...((toolCall.extra_content?.google as any)?.thought_signature
          ? {
              signature: (toolCall.extra_content?.google as any)
                .thought_signature,
            }
          : {}),
      },
    }

    if (!toolCall.normalizeAtStop && toolCall.jsonBuffer) {
      yield {
        type: 'content_block_delta' as const,
        index: blockIndex,
        delta: {
          type: 'input_json_delta' as const,
          partial_json: toolCall.jsonBuffer,
        },
      }
      toolCall.emittedJsonLength = toolCall.jsonBuffer.length
    }
  }

  const orderedActiveToolCalls = (): ActiveOpenAIToolCall[] =>
    [...activeToolCalls.entries()]
      .sort(([leftProtocolIndex], [rightProtocolIndex]) =>
        leftProtocolIndex - rightProtocolIndex,
      )
      .map(([, toolCall]) => toolCall)

  const flushReadyToolCalls = async function* () {
    for (const toolCall of orderedActiveToolCalls()) {
      if (toolCall.index === null) {
        toolCall.index = contentBlockIndex++
      }
      if (!toolCall.hasStarted) {
        yield* startToolCall(toolCall)
        if (!toolCall.hasStarted) {
          continue
        }
      }

      if (toolCall.normalizeAtStop) {
        yield {
          type: 'content_block_delta' as const,
          index: toolCall.index,
          delta: {
            type: 'input_json_delta' as const,
            partial_json: JSON.stringify(
              normalizeToolArguments(toolCall.name, toolCall.jsonBuffer),
            ),
          },
        }
      } else if (toolCall.emittedJsonLength < toolCall.jsonBuffer.length) {
        yield {
          type: 'content_block_delta' as const,
          index: toolCall.index,
          delta: {
            type: 'input_json_delta' as const,
            partial_json: toolCall.jsonBuffer.slice(
              toolCall.emittedJsonLength,
            ),
          },
        }
        toolCall.emittedJsonLength = toolCall.jsonBuffer.length
      }
      toolCall.hasStopped = true
      yield { type: 'content_block_stop' as const, index: toolCall.index }
    }
  }

  const discardActiveToolCalls = (reason: string): void => {
    if (activeToolCalls.size > 0) {
      logForDebugging(
        JSON.stringify({
          type: 'discarded_uncommitted_tool_calls',
          model,
          reason,
          count: activeToolCalls.size,
        }),
        { level: 'warn' },
      )
    }
    activeToolCalls.clear()
  }

  const closeOpenBlocksForFailure = async function* () {
    if (hasEmittedContentStart) {
      yield* closeActiveContentBlock()
    }
    if (hasEmittedThinkingStart && !hasClosedThinking) {
      const thinkingBlockIndex = contentBlockIndex
      hasClosedThinking = true
      contentBlockIndex++
      yield { type: 'content_block_stop', index: thinkingBlockIndex }
    }

    for (const toolCall of orderedActiveToolCalls()) {
      if (
        !toolCall.hasStarted ||
        toolCall.hasStopped ||
        toolCall.index === null
      ) continue
      toolCall.hasStopped = true
      yield { type: 'content_block_stop', index: toolCall.index }
    }
    discardActiveToolCalls('stream_exception')
  }

  const resolveProtocolIndex = (
    toolCall: OpenAIStreamToolCallDelta,
    batchSize: number,
  ): number => {
    if (Number.isInteger(toolCall.index)) return toolCall.index as number

    if (typeof toolCall.id === 'string' && toolCall.id) {
      const matches = [...activeToolCalls.entries()].filter(([, active]) =>
        active.idFragments.includes(toolCall.id!),
      )
      if (matches.length === 1) return matches[0]![0]
      if (matches.length > 1) {
        throw new Error(
          'Upstream omitted tool index and reused an ambiguous tool call ID; no tool was committed.',
        )
      }
      if (activeToolCalls.size === 1 && batchSize === 1) {
        return activeToolCalls.keys().next().value as number
      }
      return nextSyntheticProtocolIndex--
    }

    if (batchSize === 1 && activeToolCalls.size === 1) {
      return activeToolCalls.keys().next().value as number
    }
    if (batchSize === 1 && activeToolCalls.size === 0) {
      return nextSyntheticProtocolIndex--
    }
    throw new Error(
      'Upstream omitted tool indices for parallel calls; no tool was committed.',
    )
  }

  try {
    while (true) {
      let readResult: ReaderResult
      if (sawDoneMarker) {
        const remaining = (terminalGraceDeadline ?? Date.now()) - Date.now()
        if (remaining <= 0) {
          cancelReader('OpenAI SSE terminal grace elapsed')
          readResult = { done: true, value: undefined }
        } else {
          readResult = await readWithTimeout(remaining, true)
        }
      } else {
        readResult = await readWithTimeout()
      }
      const { done, value } = readResult
      if (done) {
        try {
          buffer += decoder.decode()
        } catch {
          reportDiagnostic?.('client_decode', 'invalid_utf8')
          throw new Error(
            'Upstream SSE contained invalid UTF-8; the response was not committed.',
          )
        }
        if (buffer.length > MAX_SSE_LINE_BUFFER_CHARS) {
          reportDiagnostic?.('client_decode', 'resource_limit_exceeded')
          throw new Error(
            'Upstream SSE line exceeded the client safety limit; the response was not committed.',
          )
        }
        if (sawDoneMarker && buffer.length > 0) {
          reportDiagnostic?.('client_semantic', 'post_terminal_output')
          throw new Error(
            'Upstream SSE emitted bytes after [DONE]; the late output was not committed.',
          )
        }
        // Distinguish a real end-of-stream (we already saw finish_reason) from
        // an upstream that closed mid-flight (no finish_reason yet). The latter
        // used to look like a natural turn end, which is the silent-stop bug
        // users reported on long runs. Throw so withRetry/error UI surfaces it
        // instead of yielding message_stop with no stop_reason.
        if (!hasProcessedFinishReason) {
          reportDiagnostic?.('client_semantic', 'missing_terminal')
          const elapsedSec = Math.round((Date.now() - streamStartedAt) / 1000)
          logForDebugging(
            JSON.stringify({
              type: 'premature_stream_close',
              model,
              total_chunks: getStreamStats(streamState).totalChunks,
              duration_ms: Date.now() - streamStartedAt,
              had_content: hasEmittedContentStart || hasEmittedThinkingStart,
            }),
            { level: 'error' },
          )
          discardActiveToolCalls('premature_eof')
          throw new Error(
            `Upstream stream closed without finish_reason after ${elapsedSec}s — likely a guard_proxy/vLLM disconnect. The session was interrupted, not completed.`,
          )
        }
		if (!sawDoneMarker) {
		  reportDiagnostic?.('client_semantic', 'missing_terminal')
		  throw new Error(
			'Upstream stream closed without [DONE]; the response was not committed.',
		  )
		}
        break
      }

      if (value.byteLength > MAX_SSE_READ_CHUNK_BYTES) {
        reportDiagnostic?.('client_decode', 'resource_limit_exceeded')
        throw new Error(
          'Upstream SSE transport chunk exceeded the client safety limit; the response was not committed.',
        )
      }
      try {
        buffer += decoder.decode(value, { stream: true })
      } catch {
        reportDiagnostic?.('client_decode', 'invalid_utf8')
        throw new Error(
          'Upstream SSE contained invalid UTF-8; the response was not committed.',
        )
      }
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      if (
        buffer.length > MAX_SSE_LINE_BUFFER_CHARS ||
        lines.some(line => line.length > MAX_SSE_LINE_BUFFER_CHARS)
      ) {
        reportDiagnostic?.('client_decode', 'resource_limit_exceeded')
        throw new Error(
          'Upstream SSE line exceeded the client safety limit; the response was not committed.',
        )
      }

      for (const line of lines) {
        const trimmed = line.trim()
		if (sawDoneMarker) {
		  if (!trimmed && pendingDoneEventDelimiter) {
			pendingDoneEventDelimiter = false
			continue
		  }
		  reportDiagnostic?.('client_semantic', 'post_terminal_output')
		  throw new Error(
			'Upstream SSE emitted bytes after [DONE]; the late output was not committed.',
		  )
		}
		if (!trimmed) continue
        if (trimmed === 'data: [DONE]') {
          if (!hasProcessedFinishReason) {
            reportDiagnostic?.('client_semantic', 'missing_terminal')
            throw new Error(
              'Upstream SSE emitted [DONE] without finish_reason; the response was not committed.',
            )
          }
          sawDoneMarker = true
          pendingDoneEventDelimiter = true
          terminalGraceDeadline ??= Date.now() + STREAM_TERMINAL_GRACE_MS
          continue
        }
        if (!trimmed.startsWith('data: ')) continue

        let chunk: OpenAIStreamChunk
        try {
          chunk = JSON.parse(trimmed.slice(6))
        } catch {
          reportDiagnostic?.('client_parse', 'invalid_sse_json')
          throw new Error(
            'Upstream emitted invalid SSE JSON; the response was not committed.',
          )
        }

        // Router status signal (e.g. verboo-code-router emite quando o backend
        // está em cold start). Chunk não tem `choices`, então parsers OpenAI
        // padrão ignoram. Aqui notificamos o caller para mostrar status
        // transitório sem poluir histórico.
        const routerStatus = (chunk as unknown as { router_status?: string })
          .router_status
        if (typeof routerStatus === 'string') {
          if (routerStatus === 'warming') {
            // Servidor sinalizou cold start: mostra o aviso já (não espera o
            // cronômetro por tempo).
            warmingHint?.showNow()
          }
          continue
        }

        // In-stream error event. Used by OpenAI when a stream fails after
        // headers have been sent, and by intermediaries (e.g. gateways) that
        // want to signal a structured failure without dropping the TCP
        // connection. Surface it as an APIError so callers see a clean
        // message instead of "stream ended without [DONE]".
        const inStreamError = (
          chunk as unknown as {
            error?: { message?: string; type?: string; code?: string }
          }
        ).error
        if (inStreamError && typeof inStreamError === 'object') {
          const message =
            typeof inStreamError.message === 'string'
              ? inStreamError.message
              : 'Provider returned an in-stream error'
          discardActiveToolCalls('in_stream_error')
          // Do NOT yield message_stop here — the synthetic API error
          // message (createAssistantAPIErrorMessage) is responsible for
          // resetting the TUI spinner. Yielding message_stop before the
          // throw would terminate the stream state prematurely.
          const errorPayload = {
            error: {
              message,
              type: inStreamError.type ?? 'api_error',
              code: inStreamError.code ?? null,
            },
          }
          throw APIError.generate(
            (response.status ?? 200) as number,
            errorPayload,
            message,
            response.headers as unknown as Headers,
          )
        }

        const chunkUsage = convertChunkUsage(chunk.usage)

        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta ?? {}

          if (
            choice.finish_reason != null &&
            (typeof choice.finish_reason !== 'string' ||
              !choice.finish_reason.trim())
          ) {
            throw new Error(
              'Upstream emitted a malformed finish_reason; the response was not committed.',
            )
          }

          if (hasProcessedFinishReason) {
            const hasLateOutput = Object.entries(delta).some(([key, value]) => {
              if (key === 'role' || value == null || value === '') return false
              if (Array.isArray(value)) return value.length > 0
              if (typeof value === 'object') {
                return Object.keys(value as Record<string, unknown>).length > 0
              }
              return true
            })
            if (hasLateOutput) {
              reportDiagnostic?.('client_semantic', 'post_terminal_output')
              throw new Error(
                'Upstream emitted assistant output after finish_reason; the late output was not committed.',
              )
            }
            // Tolerate providers that repeat an empty terminal choice, but a
            // terminal event can never reopen text or tool protocol state.
            continue
          }

          if (
            activeToolCalls.size > 0 &&
            ((delta.reasoning_content != null &&
              delta.reasoning_content !== '') ||
              (delta.content != null && delta.content !== ''))
          ) {
            throw new Error(
              'Upstream emitted text after a reserved tool block; the out-of-order response was not committed.',
            )
          }

          // Reasoning models (e.g. GLM-5, DeepSeek) may stream chain-of-thought
          // in `reasoning_content` before the actual reply appears in `content`.
          // Emit reasoning as a thinking block and content as a text block.
          if (
            delta.reasoning_content != null &&
            delta.reasoning_content !== ''
          ) {
			requireRenderableUnicode(delta.reasoning_content)
            reserveRenderableText(delta.reasoning_content)
            if (hasClosedThinking || hasEmittedContentStart) {
              throw new Error(
                'Upstream emitted reasoning after visible text; the out-of-order delta was not committed.',
              )
            }
            if (!hasEmittedThinkingStart) {
              yield {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'thinking', thinking: '' },
              }
              hasEmittedThinkingStart = true
            }
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: {
                type: 'thinking_delta',
                thinking: delta.reasoning_content,
              },
            }
          }

          // Text content — use != null to distinguish absent field from empty string,
          // some providers send "" as first delta to signal streaming start
          if (delta.content != null && delta.content !== '') {
			requireRenderableUnicode(delta.content)
            // Close thinking block if transitioning from reasoning to content
            if (hasEmittedThinkingStart && !hasClosedThinking) {
              yield { type: 'content_block_stop', index: contentBlockIndex }
              contentBlockIndex++
              hasClosedThinking = true
            }
            if (!hasEmittedContentStart) {
              yield {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              }
              hasEmittedContentStart = true
            }

            const visible = thinkFilter.feed(delta.content)
            if (visible) {
              reserveRenderableText(visible)
              yield {
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: { type: 'text_delta', text: visible },
              }
            }
            processStreamChunk(streamState, delta.content)
          }

          // Tool calls. Legacy `function_call` is normalized into the same
          // buffered lifecycle and receives a deterministic synthetic ID.
          const streamedToolCalls: OpenAIStreamToolCallDelta[] = [
            ...(delta.tool_calls ?? []),
          ]
          if (delta.function_call) {
            streamedToolCalls.push({
              index: -1,
              id: `${messageId}_function_call`,
              type: 'function',
              function: delta.function_call,
            })
          }
          if (streamedToolCalls.length > 0) {
            for (const tc of streamedToolCalls) {
              if (
                (tc.id != null && typeof tc.id !== 'string') ||
                (tc.function?.name != null &&
                  typeof tc.function.name !== 'string') ||
                (tc.function?.arguments != null &&
                  typeof tc.function.arguments !== 'string')
              ) {
                discardActiveToolCalls('malformed_tool_call_delta')
                throw new Error(
                  'Upstream returned malformed tool call fields; no tool was committed.',
                )
              }
              let protocolIndex: number
              try {
                protocolIndex = resolveProtocolIndex(
                  tc,
                  streamedToolCalls.length,
                )
              } catch (error) {
                discardActiveToolCalls('ambiguous_missing_tool_index')
                throw error
              }
              let active = activeToolCalls.get(protocolIndex)
              if (!active) {
				if (activeToolCalls.size >= MAX_ACTIVE_TOOL_CALLS) {
				  reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
				  discardActiveToolCalls('tool_call_count_limit_exceeded')
				  throw new Error(
				    'Upstream emitted too many parallel tool calls; no tool was committed.',
				  )
				}
                // A tool call may arrive as separate id, name, and argument
                // chunks. Reserve its block once, keyed by the OpenAI index,
                // instead of requiring id + name to be co-located.
                if (hasEmittedThinkingStart && !hasClosedThinking) {
                  yield {
                    type: 'content_block_stop',
                    index: contentBlockIndex,
                  }
                  contentBlockIndex++
                  hasClosedThinking = true
                }
                if (hasEmittedContentStart) {
                  yield* closeActiveContentBlock()
                }

                active = {
                  id: '',
                  name: '',
                  idFragments: [],
                  nameFragments: [],
				  identityChars: 0,
                  index: null,
                  jsonBuffer: '',
                  ambiguousArgumentFraming: false,
                  emittedJsonLength: 0,
                  normalizeAtStop: false,
                  hasStarted: false,
                  hasStopped: false,
				  extraContentChars: 0,
                }
                activeToolCalls.set(protocolIndex, active)
              }

              if (tc.id) {
				if (hasInvalidUnicodeScalar(tc.id)) {
				  reportDiagnostic?.('client_semantic', 'invalid_unicode_scalar')
				  discardActiveToolCalls('invalid_tool_call_id_unicode')
				  throw new Error(
				    'Upstream tool call ID contained an invalid Unicode scalar; no tool was committed.',
				  )
				}
				if (tc.id.length > MAX_TOOL_ID_OR_NAME_FRAGMENT_CHARS) {
				  reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
				  discardActiveToolCalls('tool_call_id_limit_exceeded')
				  throw new Error(
				    'Upstream tool call ID exceeded the client safety limit; no tool was committed.',
				  )
				}
				if (active.idFragments.at(-1) !== tc.id) {
				  if (
				    active.identityChars + tc.id.length > MAX_TOOL_IDENTITY_CHARS_PER_CALL ||
				    totalBufferedToolIdentityChars + tc.id.length > MAX_BUFFERED_TOOL_IDENTITY_CHARS
				  ) {
				    reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
				    discardActiveToolCalls('tool_call_identity_limit_exceeded')
				    throw new Error(
				      'Upstream tool call identity exceeded the client safety limit; no tool was committed.',
				    )
				  }
				  active.idFragments.push(tc.id)
				  active.identityChars += tc.id.length
				  totalBufferedToolIdentityChars += tc.id.length
				}
              }

              const nameFragment = tc.function?.name
              if (nameFragment) {
				if (hasInvalidUnicodeScalar(nameFragment)) {
				  reportDiagnostic?.('client_semantic', 'invalid_unicode_scalar')
				  discardActiveToolCalls('invalid_tool_name_unicode')
				  throw new Error(
				    'Upstream tool name contained an invalid Unicode scalar; no tool was committed.',
				  )
				}
				if (nameFragment.length > MAX_TOOL_ID_OR_NAME_FRAGMENT_CHARS) {
				  reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
				  discardActiveToolCalls('tool_name_fragment_limit_exceeded')
				  throw new Error(
				    'Upstream tool name fragment exceeded the client safety limit; no tool was committed.',
				  )
				}
				if (
				  active.identityChars + nameFragment.length > MAX_TOOL_IDENTITY_CHARS_PER_CALL ||
				  totalBufferedToolIdentityChars + nameFragment.length > MAX_BUFFERED_TOOL_IDENTITY_CHARS
				) {
				  reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
				  discardActiveToolCalls('tool_call_identity_limit_exceeded')
				  throw new Error(
				    'Upstream tool call identity exceeded the client safety limit; no tool was committed.',
				  )
				}
				active.nameFragments.push(nameFragment)
				active.identityChars += nameFragment.length
				totalBufferedToolIdentityChars += nameFragment.length
              }

              const argumentFragment = tc.function?.arguments
              if (typeof argumentFragment === 'string') {
                if (
                  argumentFragment.length > 0 &&
                  active.jsonBuffer.length > 0 &&
                  argumentFragment.startsWith(active.jsonBuffer)
                ) {
                  // A valid delta and a cumulative snapshot are indistinguishable
                  // here. Concatenating the latter can silently change a raw Bash
                  // command or file path, so fail closed at the terminal instead
                  // of guessing which wire convention the provider intended.
                  active.ambiguousArgumentFraming = true
                }
                if (
                  active.jsonBuffer.length + argumentFragment.length >
                    toolArgumentCharsLimit ||
                  totalBufferedToolArgumentChars + argumentFragment.length >
                    toolArgumentCharsLimit
                ) {
				  reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
                  discardActiveToolCalls('tool_arguments_limit_exceeded')
                  throw new Error(
                    'Upstream tool arguments exceeded the configured safety limit; no tool was committed.',
                  )
                }
                active.jsonBuffer += argumentFragment
                totalBufferedToolArgumentChars += argumentFragment.length
                processStreamChunk(streamState, argumentFragment)
              }

              // Capture extra_content / thought_signature whether it arrives
              // with the initial metadata, arguments, or in its own chunk.
              const thoughtSignature = (tc as any).thought_signature
              let extraContent: Record<string, unknown> | undefined
              if (typeof thoughtSignature === 'string' && thoughtSignature) {
                extraContent = {
                  google: { thought_signature: thoughtSignature },
                }
              }
              if (tc.extra_content) {
				if (hasInvalidUnicodeScalarDeep(tc.extra_content)) {
				  reportDiagnostic?.('client_semantic', 'invalid_unicode_scalar')
				  discardActiveToolCalls('invalid_tool_metadata_unicode')
				  throw new Error(
					'Upstream tool metadata contained an invalid Unicode scalar; no tool was committed.',
				  )
				}
				try {
				  if (
					JSON.stringify(tc.extra_content).length >
					MAX_OPAQUE_TOOL_METADATA_CHARS_PER_CALL
				  ) {
					throw new Error('opaque tool metadata exceeded size limit')
				  }
				  extraContent = mergeOpaqueMetadata(extraContent, tc.extra_content)
				} catch {
				  reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
				  discardActiveToolCalls('tool_metadata_limit_exceeded')
				  throw new Error(
					'Upstream tool metadata exceeded the client safety limit; no tool was committed.',
				  )
				}
              }
              if (extraContent) {
				try {
				  const merged = mergeOpaqueMetadata(
					active.extra_content,
					extraContent,
				  )
				  const mergedChars = JSON.stringify(merged).length
				  const nextTotal =
					totalBufferedOpaqueToolMetadataChars -
					active.extraContentChars +
					mergedChars
				  if (
					mergedChars > MAX_OPAQUE_TOOL_METADATA_CHARS_PER_CALL ||
					nextTotal > MAX_BUFFERED_OPAQUE_TOOL_METADATA_CHARS
				  ) {
					throw new Error('opaque tool metadata exceeded size limit')
				  }
				  active.extra_content = merged
				  active.extraContentChars = mergedChars
				  totalBufferedOpaqueToolMetadataChars = nextTotal
				} catch {
				  reportDiagnostic?.('client_semantic', 'resource_limit_exceeded')
				  discardActiveToolCalls('tool_metadata_limit_exceeded')
				  throw new Error(
					'Upstream tool metadata exceeded the client safety limit; no tool was committed.',
				  )
				}
              }

            }

            // Keep the call buffered until finish_reason. The provider can
            // still send late name fragments or metadata after arguments;
            // emitting early would require a protocol-invalid second
            // content_block_start to correct the block later.
          }

          // Finish — guard ensures we only process finish_reason once even if
          // multiple chunks arrive with finish_reason set (some providers do this)
          if (choice.finish_reason && !hasProcessedFinishReason) {
            hasProcessedFinishReason = true

            // Close any open thinking block that wasn't closed by content transition
            if (hasEmittedThinkingStart && !hasClosedThinking) {
              yield { type: 'content_block_stop', index: contentBlockIndex }
              contentBlockIndex++
              hasClosedThinking = true
            }
            // Close any open content blocks
            if (hasEmittedContentStart) {
              yield* closeActiveContentBlock()
            }
            const isToolFinish =
              choice.finish_reason === 'tool_calls' ||
              choice.finish_reason === 'function_call'
            if (!isToolFinish) {
              discardActiveToolCalls(`finish_reason:${choice.finish_reason}`)
            } else {
              const invalidReasons: string[] = []
              const finalizedToolCallIds = new Set<string>()
              for (const toolCall of activeToolCalls.values()) {
                const invalidReason = finalizeToolCall(toolCall)
                if (invalidReason) invalidReasons.push(invalidReason)
                if (toolCall.id) {
                  if (finalizedToolCallIds.has(toolCall.id)) {
                    invalidReasons.push('duplicate_tool_call_id_across_indices')
                  }
                  finalizedToolCallIds.add(toolCall.id)
                }
                toolCall.normalizeAtStop = hasToolFieldMapping(toolCall.name)
              }
              if (activeToolCalls.size === 0 || invalidReasons.length > 0) {
                discardActiveToolCalls(
                  invalidReasons.length > 0
                    ? invalidReasons.join(',')
                    : 'tool_finish_without_tool_call',
                )
                throw new Error(
                  `Upstream returned ${choice.finish_reason} with an incomplete or ambiguous tool call; no tool was committed.`,
                )
              }

              yield* flushReadyToolCalls()
              activeToolCalls.clear()
            }

            const stopReason =
              choice.finish_reason === 'tool_calls' ||
              choice.finish_reason === 'function_call'
                ? 'tool_use'
                : choice.finish_reason === 'length'
                  ? 'max_tokens'
                  : 'end_turn'
            if (
              choice.finish_reason === 'content_filter' ||
              choice.finish_reason === 'safety'
            ) {
              const warning =
                '\n\n[Content blocked by provider safety filter]'
              reserveRenderableText(warning)
              // Gemini/Azure content safety filter blocked the response.
              // Emit a visible text block so the user knows why output was truncated.
              if (!hasEmittedContentStart) {
                yield {
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: '' },
                }
                hasEmittedContentStart = true
              }
              yield {
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: {
                  type: 'text_delta',
                  text: warning,
                },
              }
            } else if (choice.finish_reason === 'length') {
              const warning =
                '\n\n[Response truncated — reached length limit or upstream stalled. Ask the model to continue.]'
              reserveRenderableText(warning)
              // Response was truncated — either the model hit max_tokens, or
              // an upstream/gateway watchdog synthesized a graceful end after
              // detecting a stalled stream. Either way, the user should know
              // the answer they're seeing isn't complete.
              if (!hasEmittedContentStart) {
                yield {
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: '' },
                }
                hasEmittedContentStart = true
              }
              yield {
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: {
                  type: 'text_delta',
                  text: warning,
                },
              }
            }
            // Safety/length warnings above open a synthetic text block after
            // the original content was closed. Balance that block before the
            // terminal message events so Ink never receives an unterminated
            // content lifecycle.
            if (hasEmittedContentStart) {
              yield* closeActiveContentBlock()
            }
            lastStopReason = stopReason

            yield {
              type: 'message_delta',
              delta: { stop_reason: stopReason, stop_sequence: null },
              ...(chunkUsage ? { usage: chunkUsage, ...usagePresence(chunk.usage) } : {}),
            }
            if (chunkUsage) {
              hasEmittedFinalUsage = true
            }
          }
        }

        if (
          !hasEmittedFinalUsage &&
          chunkUsage &&
          (chunk.choices?.length ?? 0) === 0 &&
          lastStopReason !== null
        ) {
          yield {
            type: 'message_delta',
            delta: { stop_reason: lastStopReason, stop_sequence: null },
            usage: chunkUsage,
            ...usagePresence(chunk.usage),
          }
          hasEmittedFinalUsage = true
        }
      }
    }
  } catch (error) {
    // Any rejected read, idle timeout, malformed delta, or conversion error
    // must leave Anthropic's block lifecycle balanced before surfacing the
    // failure. Ink otherwise retains a half-open node and can render stale,
    // overlapping characters on subsequent updates.
    yield* closeOpenBlocksForFailure()
    throw error
  } finally {
    await pendingReaderCancellation
    try {
      reader.releaseLock()
    } catch (releaseError) {
      logForDebugging(
        `Failed to release OpenAI stream reader after cancellation: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        { level: 'warn' },
      )
    }
  }

  const stats = getStreamStats(streamState)
  if (stats.totalChunks > 0) {
    logForDebugging(
      JSON.stringify({
        type: 'stream_stats',
        model,
        total_chunks: stats.totalChunks,
        first_token_ms: stats.firstTokenMs,
        duration_ms: stats.durationMs,
      }),
      { level: 'debug' },
    )
  }

  yield { type: 'message_stop' }
}

// ---------------------------------------------------------------------------
// The shim client — duck-types as Anthropic SDK
// ---------------------------------------------------------------------------

class OpenAIShimStream {
  private generator: AsyncGenerator<AnthropicStreamEvent>
  // The controller property is checked by claude.ts to distinguish streams from error messages
  controller = new AbortController()
  private warmingHint?: WarmingHintController
  private unconsumedCleanupTimer: ReturnType<typeof setTimeout> | null

  constructor(
    generator: AsyncGenerator<AnthropicStreamEvent>,
    warmingHint?: WarmingHintController,
  ) {
    this.generator = generator
    this.warmingHint = warmingHint
    // The normal caller starts iterating immediately after awaiting
    // withResponse(). If it abandons the returned stream, dispose the hint on
    // the next event-loop turn so no status can leak into a later query.
    this.unconsumedCleanupTimer = warmingHint
      ? setTimeout(() => {
          this.unconsumedCleanupTimer = null
          warmingHint.resolve()
        }, 0)
      : null
  }

  private markConsumed(): void {
    if (this.unconsumedCleanupTimer !== null) {
      clearTimeout(this.unconsumedCleanupTimer)
      this.unconsumedCleanupTimer = null
    }
  }

  private hasMeaningfulOutput(event: AnthropicStreamEvent): boolean {
    if (
      event.type === 'content_block_start' &&
      event.content_block?.type === 'tool_use'
    ) {
      return true
    }
    if (event.type !== 'content_block_delta') return false

    const delta = event.delta
    if (!delta) return false
    return (
      (typeof delta.text === 'string' && delta.text.length > 0) ||
      (typeof delta.thinking === 'string' && delta.thinking.length > 0) ||
      (typeof delta.partial_json === 'string' &&
        delta.partial_json.length > 0)
    )
  }

  async *[Symbol.asyncIterator]() {
    this.markConsumed()
    try {
      for await (const event of this.generator) {
        if (this.hasMeaningfulOutput(event)) {
          this.warmingHint?.resolve()
        }
        yield event
      }
    } finally {
      this.warmingHint?.resolve()
    }
  }
}

type ShimProviderOverride = {
  model: string
  baseURL: string
  apiKey: string
  /** Opaque local account selected for this process, when using Codex OAuth. */
  localAccountId?: string
  /** Reads a credential lazily so a refreshed OAuth token is used by an existing client. */
  getApiKey?: () => string
  /** Returns a replacement credential after an authentication failure. */
  refreshApiKey?: (failedApiKey: string) => Promise<string | null>
}

class OpenAIShimMessages {
  private defaultHeaders: Record<string, string>
  private reasoningEffort?: string
  private suppressReasoningEffort: boolean
  private providerOverride?: ShimProviderOverride

  constructor(
    defaultHeaders: Record<string, string>,
    reasoningEffort?: string,
    providerOverride?: ShimProviderOverride,
    suppressReasoningEffort = false,
  ) {
    this.defaultHeaders = filterAnthropicHeaders(defaultHeaders)
    this.reasoningEffort = reasoningEffort
    this.providerOverride = providerOverride
    this.suppressReasoningEffort = suppressReasoningEffort
  }

  /**
   * Pre-pass for models without vision: replace every image block with a
   * text analysis produced by a vision-capable router model (one nested,
   * non-streaming create per unique image group; results are cached).
   * No-op when delegation is disabled, a provider override is active (local
   * backends route every model id to the override), the target model has
   * vision, or there are no images.
   */
  private async _maybeDelegateVision(
    messages: Array<{
      role: string
      message?: { role?: string; content?: unknown }
      content?: unknown
    }>,
    resolvedModel: string,
    options?: { signal?: AbortSignal },
  ): Promise<
    Array<{
      role: string
      message?: { role?: string; content?: unknown }
      content?: unknown
    }>
  > {
    if (!isVisionDelegationEnabled()) return messages
    // Only the Verboo router path can reach the vision-capable router
    // models — skip for external providers (per-agent local backends, etc.)
    // and let the belt-and-suspenders strip protect the request.
    const routerOverride = this.providerOverride
    if (!routerOverride || !isVerbooRouterUrl(routerOverride.baseURL)) {
      return messages
    }
    // modelSupportsVision returns undefined when the model is not in the
    // catalog — keep images inline until the catalog is fetched.
    if (modelSupportsVision(resolvedModel) !== false) return messages
    if (!messagesContainImages(messages)) return messages

    const visionModel = pickVisionModel()
    if (!visionModel) {
      return delegateImagesInMessages(messages, undefined, undefined)
    }

    const self = new OpenAIShimMessages(this.defaultHeaders, undefined, {
      ...routerOverride,
      model: visionModel,
    })
    return delegateImagesInMessages(
      messages,
      visionModel,
      async ({ model, images, prompt }) => {
        const result = await (self.create(
          {
            model,
            max_tokens: 2048,
            stream: false,
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: prompt }, ...images],
              },
            ],
          } as ShimCreateParams,
          { signal: options?.signal },
        ) as Promise<{ content?: Array<{ type?: string; text?: string }> }>)
        const text = Array.isArray(result?.content)
          ? result.content
              .filter(block => block?.type === 'text')
              .map(block => block.text ?? '')
              .join('\n')
              .trim()
          : ''
        if (!text) {
          throw new Error(
            `vision model ${model} returned an empty analysis`,
          )
        }
        return text
      },
    ) as Promise<
      Array<{
        role: string
        message?: { role?: string; content?: unknown }
        content?: unknown
      }>
    >
  }

  create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const self = this
    const {
      names: advertisedToolNames,
      recoverableNames: recoverableToolNames,
    } = getAdvertisedToolResolution(params)

    let httpResponse: Response | undefined

    const promise = (async () => {
      const request = resolveProviderRequest({
        model: self.providerOverride?.model ?? params.model,
        baseUrl: self.providerOverride?.baseURL,
        reasoningEffortOverride: self.reasoningEffort,
        suppressReasoningEffort: self.suppressReasoningEffort,
      })
      // Cronômetro do aviso "preparando" começa AQUI (no envio da requisição),
      // então cobre tanto a resposta lenta quanto a requisição pendurada antes
      // de qualquer resposta. É resolvido: no gerador de streaming (quando o
      // conteúdo chega ou o stream termina), logo abaixo nos caminhos
      // não-stream, ou aqui no catch se a própria requisição falhar.
      const warmingHint = createWarmingHintController(options?.signal)
      warmingHint.schedule(getSlowHintMs())
      let response: Response
      try {
        response = await self._doRequest(request, params, options)
      } catch (e) {
        warmingHint.resolve()
        throw e
      }
      httpResponse = response

      if (params.stream) {
        const isResponsesStream = response.url?.includes('/responses')
        return new OpenAIShimStream(
          request.transport === 'codex_responses' ||
            request.transport === 'responses' ||
            isResponsesStream
            ? codexStreamToAnthropic(
                response,
                request.resolvedModel,
                options?.signal,
                advertisedToolNames,
                recoverableToolNames,
              )
            : openaiStreamToAnthropic(
                response,
                request.resolvedModel,
                options?.signal,
                warmingHint,
                advertisedToolNames,
                recoverableToolNames,
                clientDiagnosticReporters.get(response),
              ),
          warmingHint,
        )
      }

      // Caminhos não-stream: a resposta HTTP já chegou, então o aviso cumpriu
      // seu papel — limpa antes de coletar/converter o corpo.
      warmingHint.resolve()

      if (request.transport === 'codex_responses') {
        const data = await collectCodexCompletedResponse(
          response,
          options?.signal,
        )
        return convertCodexResponseToAnthropicMessage(
          data,
          request.resolvedModel,
          advertisedToolNames,
          recoverableToolNames,
        )
      }

      const isResponsesNonStream = response.url?.includes('/responses')
      if (
        request.transport === 'responses' ||
        isResponsesNonStream ||
        (request.transport === 'chat_completions' && isGithubModelsMode())
      ) {
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          const parsed = await readSuccessfulResponseJson<any>(response)
          if (
            parsed &&
            typeof parsed === 'object' &&
            ('output' in parsed || 'incomplete_details' in parsed)
          ) {
            return convertCodexResponseToAnthropicMessage(
              parsed,
              request.resolvedModel,
              advertisedToolNames,
              recoverableToolNames,
            )
          }
          return self._convertNonStreamingResponse(
            parsed,
            request.resolvedModel,
            advertisedToolNames,
            recoverableToolNames,
          )
        }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const data = await readSuccessfulResponseJson<any>(response)
        return self._convertNonStreamingResponse(
          data,
          request.resolvedModel,
          advertisedToolNames,
          recoverableToolNames,
        )
      }

      const textBody = await readSuccessfulResponseText(response).catch(
        () => '',
      )
      throw APIError.generate(
        response.status,
        undefined,
        `OpenAI API error ${response.status}: unexpected response: ${textBody.slice(0, 500)}`,
        response.headers as unknown as Headers,
      )
    })()

    ;(promise as unknown as Record<string, unknown>).withResponse =
      async () => {
        const data = await promise
        return {
          data,
          response: httpResponse ?? new Response(),
          request_id:
            httpResponse?.headers.get(VERBOO_REQUEST_ID_HEADER) ??
            httpResponse?.headers.get('x-request-id') ??
            makeMessageId(),
        }
      }

    return promise
  }

  private async _doRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    const githubEndpointType = getGithubEndpointType(request.baseUrl)
    const isGithubMode = isGithubModelsMode()
    const isGithubWithCodexTransport =
      isGithubMode && request.transport === 'codex_responses'

    if (isGithubWithCodexTransport) {
      const apiKey =
        this.providerOverride?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
      if (!apiKey) {
        throw new Error(
          'GitHub Copilot auth is required. Run /onboard-github to sign in.',
        )
      }

      return performCodexRequest({
        request,
        credentials: {
          apiKey,
          source: 'env',
        },
        params,
        defaultHeaders: {
          ...this.defaultHeaders,
          ...filterAnthropicHeaders(options?.headers),
          ...COPILOT_HEADERS,
        },
        signal: options?.signal,
      })
    }

    if (request.transport === 'codex_responses' && !isGithubMode) {
      const localAccountId = this.providerOverride?.localAccountId
      const refreshResult = await refreshCodexAccessTokenIfNeeded({
        ignoreEnvironment: isVerbooMode(),
        localAccountId,
      }).catch(
        async (error) => {
          logForDebugging(
            `[codex] access token refresh failed before request: ${error instanceof Error ? error.message : String(error)}`,
            { level: 'warn' },
          )
          return {
            refreshed: false,
            credentials: await readCodexCredentialsAsync(localAccountId),
          }
        },
      )
      const credentials: ResolvedCodexCredentials =
        isVerbooMode() && refreshResult.credentials
          ? resolveStoredCodexCredentials({
              storedCredentials: refreshResult.credentials,
            })
          : isVerbooMode()
            ? { apiKey: '', source: 'none' as const }
            : resolveRuntimeCodexCredentials({
                storedCredentials: refreshResult.credentials,
              })
      if (!credentials.apiKey) {
        const oauthHint = isVerbooMode()
          ? ' Execute `/codex login`.'
          : isBareMode()
            ? ''
            : ', or contact your Verboo admin to switch provider'
        const authHint = credentials.authPath
          ? `${oauthHint} or place a Codex auth.json at ${credentials.authPath}`
          : oauthHint
        const safeModel =
          redactSecretValueForDisplay(
            request.requestedModel,
            process.env as SecretValueSource,
          ) ?? 'the requested model'
        throw new Error(
          isVerbooMode()
            ? `Login Codex obrigatório para usar ${safeModel}. Execute /codex login.`
            : `Codex auth is required for ${safeModel}. Set CODEX_API_KEY${authHint}.`,
        )
      }
      if (!credentials.accountId) {
        throw new Error(
          isVerbooMode()
            ? 'O login Codex está incompleto. Execute `/codex login` novamente.'
            : 'Codex auth is missing chatgpt_account_id. Re-login with Codex OAuth, the Codex CLI, or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.',
        )
      }

      const requestOptions = {
        request,
        credentials,
        params,
        defaultHeaders: {
          ...this.defaultHeaders,
          ...filterAnthropicHeaders(options?.headers),
        },
        signal: options?.signal,
      }
      try {
        return await performCodexRequest(requestOptions)
      } catch (error) {
        if ((error as { status?: number }).status !== 401) throw error
        const refreshed = await refreshCodexAccessTokenIfNeeded({
          force: true,
          ignoreEnvironment: isVerbooMode(),
          localAccountId,
        })
        if (!refreshed.credentials) throw error
        const retryCredentials = isVerbooMode()
          ? resolveStoredCodexCredentials({
              storedCredentials: refreshed.credentials,
            })
          : resolveRuntimeCodexCredentials({
              storedCredentials: refreshed.credentials,
            })
        return performCodexRequest({
          ...requestOptions,
          credentials: retryCredentials,
        })
      }
    }

    return this._doOpenAIRequest(request, params, options)
  }

  private async _doOpenAIRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    // Local backends (llama.cpp, vLLM, Ollama, LM Studio, …) do not implement
    // the cloud-side caching/strict-validation behaviours that several of our
    // pre-send transforms target. Computing the fast-path config once here
    // lets us skip those transforms uniformly. See providerConfig.ts.
    const fastPath: LocalFastPathConfig = getLocalFastPathConfig(
      request.baseUrl,
    )

    const rawMessages = params.messages as Array<{
      role: string
      message?: { role?: string; content?: unknown }
      content?: unknown
    }>
    const compressedMessages = fastPath.skipToolHistoryCompression
      ? rawMessages
      : compressToolHistory(rawMessages, request.resolvedModel)

    // Vision delegation: if the target model cannot see images, analyze them
    // once with a vision-capable router model and substitute the text — an
    // image block sent to a blind model 400s every request from then on
    // (history is resent each turn). Covers every source: pasted images,
    // FileRead of images, MCP tool results (browser screenshots), agents.
    const visionSafeMessages = await this._maybeDelegateVision(
      compressedMessages,
      request.resolvedModel,
      options,
    )
    // The `responses` transport serializes from the raw (uncompressed)
    // messages — delegate those too when that transport is active. The
    // analysis cache makes the second pass free for already-seen images.
    const visionSafeRawMessages =
      request.transport === 'responses'
        ? await this._maybeDelegateVision(
            rawMessages,
            request.resolvedModel,
            options,
          )
        : rawMessages

    const runtimeShimContext = resolveOpenAIShimRuntimeContext({
      processEnv: process.env,
      baseUrl: request.baseUrl,
      model: request.resolvedModel,
      treatAsLocal: isLocalProviderUrl(request.baseUrl),
    })
    const shimConfig = runtimeShimContext.openaiShimConfig
    const openaiMessages = convertMessages(visionSafeMessages, params.system, {
      preserveReasoningContent: shimConfig.preserveReasoningContent,
      reasoningContentFallback: shimConfig.reasoningContentFallback,
    })

    // Belt-and-suspenders: if the target model has NO vision, strip any
    // image_url that might have survived the delegation pre-pass (a sign
    // that some code path escaped the rewrite). Only on the Verboo router
    // path — a non-Verboo provider with a coincidental model id must not
    // be affected.
    const shouldStrip =
      isVerbooRouterUrl(request.baseUrl) &&
      modelSupportsVision(request.resolvedModel) === false
    const { messages: strippedMessages } = shouldStrip
      ? stripResidualImageParts(openaiMessages)
      : { messages: openaiMessages }

    const body: Record<string, unknown> = {
      model: request.resolvedModel,
      messages: strippedMessages,
      stream: params.stream ?? false,
      store: false,
    }

    const responseFormat = buildResponseFormatFromOutputConfig(params)
    if (responseFormat) {
      body.response_format = responseFormat
    }

    // Emit the OpenAI-compatible reasoning_effort field when the resolved
    // provider request carries a reasoning effort (set via /effort, model alias
    // default, or `?reasoning=<level>` query on the model string). Do not also
    // emit a top-level `effort` alias: strict OpenAI-compatible servers such as
    // the SGLang endpoint behind Verboo's Qwen route reject that unknown field.
    if (request.reasoning) {
      body.reasoning_effort = request.reasoning.effort
    }
    // Convert max_tokens to max_completion_tokens for OpenAI API compatibility.
    // Azure OpenAI requires max_completion_tokens and does not accept max_tokens.
    // Ensure max_tokens is a valid positive number before using it.
    const maxTokensValue =
      typeof params.max_tokens === 'number' && params.max_tokens > 0
        ? params.max_tokens
        : undefined
    const maxCompletionTokensValue =
      typeof (params as Record<string, unknown>).max_completion_tokens ===
      'number'
        ? ((params as Record<string, unknown>).max_completion_tokens as number)
        : undefined

    if (maxTokensValue !== undefined) {
      body.max_completion_tokens = maxTokensValue
    } else if (maxCompletionTokensValue !== undefined) {
      body.max_completion_tokens = maxCompletionTokensValue
    }

    if (params.stream && !isLocalProviderUrl(request.baseUrl)) {
      body.stream_options = { include_usage: true }
    }

    const isGithub = isGithubModelsMode()
    const isLocal = isLocalProviderUrl(request.baseUrl)

    const githubEndpointType = getGithubEndpointType(request.baseUrl)
    const isGithubCopilot = isGithub && githubEndpointType === 'copilot'
    const isGithubModels =
      isGithub &&
      (githubEndpointType === 'models' || githubEndpointType === 'custom')
    const shouldStripResponsesStore =
      (shimConfig.removeBodyFields ?? []).includes('store') ||
      isGeminiMode() ||
      hasGeminiApiHost(request.baseUrl) ||
      hasCerebrasApiHost(request.baseUrl) ||
      isLocal

    if (
      shimConfig.maxTokensField === 'max_tokens' &&
      body.max_completion_tokens !== undefined
    ) {
      body.max_tokens = body.max_completion_tokens
      delete body.max_completion_tokens
    }

    for (const field of shimConfig.removeBodyFields ?? []) {
      delete body[field]
    }

    if (shouldStripResponsesStore) {
      delete body.store
    }

    if (params.temperature !== undefined) body.temperature = params.temperature
    if (params.top_p !== undefined) body.top_p = params.top_p

    if (shimConfig.thinkingRequestFormat === 'deepseek-compatible') {
      const requestedThinkingType = (
        params.thinking as { type?: string } | undefined
      )?.type
      const deepSeekThinkingType =
        requestedThinkingType === 'disabled'
          ? 'disabled'
          : requestedThinkingType === 'enabled' ||
              requestedThinkingType === 'adaptive'
            ? 'enabled'
            : undefined

      if (deepSeekThinkingType) {
        body.thinking = { type: deepSeekThinkingType }
      }

      if (deepSeekThinkingType === 'enabled') {
        const effort = request.reasoning?.effort
        if (effort) {
          const normalizedEffort = normalizeDeepSeekReasoningEffort(effort)
          body.reasoning_effort = normalizedEffort
          body.effort = normalizedEffort
        }
      }
    }

    if (params.tools && params.tools.length > 0) {
      const converted = convertTools(
        params.tools as Array<{
          name: string
          description?: string
          input_schema?: Record<string, unknown>
        }>,
        { skipStrict: fastPath.skipStrictTools },
      )
      if (converted.length > 0) {
        body.tools = converted
        if (params.tool_choice) {
          const tc = params.tool_choice as { type?: string; name?: string }
          if (tc.type === 'auto') {
            body.tool_choice = 'auto'
          } else if (tc.type === 'tool' && tc.name) {
            body.tool_choice = {
              type: 'function',
              function: { name: tc.name },
            }
          } else if (tc.type === 'any') {
            body.tool_choice = 'required'
          } else if (tc.type === 'none') {
            body.tool_choice = 'none'
          }
        }
      }
    }

    let omitResponsesTools = false
    const buildResponsesBody = (): Record<string, unknown> => {
      const responsesBody: Record<string, unknown> = {
        model: request.resolvedModel,
        input: convertAnthropicMessagesToResponsesInput(
          visionSafeRawMessages as Array<{
            role?: string
            message?: { role?: string; content?: unknown }
            content?: unknown
          }>,
        ),
        stream: params.stream ?? false,
        store: false,
      }

      if (shouldStripResponsesStore) {
        delete responsesBody.store
      }

      if (
        !Array.isArray(responsesBody.input) ||
        responsesBody.input.length === 0
      ) {
        responsesBody.input = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '' }],
          },
        ]
      }

      const systemText = convertSystemPrompt(params.system)
      if (systemText) {
        responsesBody.instructions = systemText
      }

      if (body.max_tokens !== undefined) {
        responsesBody.max_output_tokens = body.max_tokens
      } else if (body.max_completion_tokens !== undefined) {
        responsesBody.max_output_tokens = body.max_completion_tokens
      }

      if (params.temperature !== undefined)
        responsesBody.temperature = params.temperature
      if (params.top_p !== undefined) responsesBody.top_p = params.top_p

      if (!omitResponsesTools && params.tools && params.tools.length > 0) {
        const convertedTools = convertToolsToResponsesTools(
          params.tools as Array<{
            name?: string
            description?: string
            input_schema?: Record<string, unknown>
          }>,
        )
        if (convertedTools.length > 0) {
          responsesBody.tools = convertedTools
        }
      }

      return responsesBody
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...filterAnthropicHeaders(shimConfig.headers),
      ...this.defaultHeaders,
      ...filterAnthropicHeaders(options?.headers),
    }
    if (isVerbooRouterUrl(request.baseUrl)) {
      headers[VERBOO_SESSION_HEADER] = getSessionId()
      headers['User-Agent'] = getVerbooCodeUserAgent()
    }

    const isGemini = isGeminiMode()
    const routeCredential = resolveRouteCredentialValue({
      routeId: runtimeShimContext.routeId,
      baseUrl: request.baseUrl,
      processEnv: process.env,
    })
    const getApiKey = (): string =>
      this.providerOverride?.getApiKey?.() ??
      this.providerOverride?.apiKey ??
      routeCredential ??
      process.env.OPENAI_API_KEY ??
      ''
    // The Verboo router always authenticates with its OAuth/API token in
    // Authorization. Parent shells may carry OpenAI gateway settings; letting
    // those overwrite this header makes a successful Verboo login appear to
    // fail only when the first chat request is sent.
    const usesVerbooRouter = isVerbooRouterUrl(request.baseUrl)
    const configuredAuthHeaderValue = usesVerbooRouter
      ? undefined
      : process.env.OPENAI_AUTH_HEADER_VALUE?.trim()
    const customAuthHeader = usesVerbooRouter
      ? undefined
      : process.env.OPENAI_AUTH_HEADER?.trim()
    const hasCustomAuthHeader = Boolean(
      customAuthHeader &&
      /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(customAuthHeader),
    )
    const applyAuthHeader = (): void => {
      const apiKey = getApiKey()
      const authValue = hasCustomAuthHeader
        ? configuredAuthHeaderValue || apiKey
        : apiKey

      delete headers.Authorization
      if (hasCustomAuthHeader && customAuthHeader) {
        delete headers[customAuthHeader]
      }

      if (authValue) {
        if (hasCustomAuthHeader && customAuthHeader) {
          const defaultCustomAuthScheme =
            customAuthHeader.toLowerCase() === 'authorization'
              ? 'bearer'
              : 'raw'
          const customAuthScheme =
            process.env.OPENAI_AUTH_SCHEME === 'raw' ||
            process.env.OPENAI_AUTH_SCHEME === 'bearer'
              ? process.env.OPENAI_AUTH_SCHEME
              : defaultCustomAuthScheme
          headers[customAuthHeader] =
            customAuthScheme === 'bearer' ? `Bearer ${authValue}` : authValue
        } else if (isAzure) {
          headers['api-key'] = authValue
        } else if (isBankr) {
          headers['X-API-Key'] = authValue
        } else if (shimConfig.defaultAuthHeader?.name) {
          headers[shimConfig.defaultAuthHeader.name] =
            shimConfig.defaultAuthHeader.scheme === 'bearer'
              ? `Bearer ${authValue}`
              : authValue
        } else {
          headers.Authorization = `Bearer ${authValue}`
        }
      }
    }
    // Detect Azure endpoints by hostname (not raw URL) to prevent bypass via
    // path segments like https://evil.com/cognitiveservices.azure.com/
    let isAzure = false
    try {
      const { hostname } = new URL(request.baseUrl)
      isAzure =
        hostname.endsWith('.azure.com') &&
        (hostname.includes('cognitiveservices') ||
          hostname.includes('openai') ||
          hostname.includes('services.ai'))
    } catch {
      /* malformed URL — not Azure */
    }

    let isBankr = false
    try {
      isBankr =
        runtimeShimContext.routeId === 'bankr' ||
        request.baseUrl.toLowerCase().includes('bankr')
    } catch {
      /* malformed URL — not Bankr */
    }

    applyAuthHeader()
    if (!getApiKey() && isGemini) {
      const geminiCredential = await resolveGeminiCredential(process.env)
      if (geminiCredential.kind !== 'none') {
        headers.Authorization = `Bearer ${geminiCredential.credential}`
        if (
          geminiCredential.kind !== 'api-key' &&
          'projectId' in geminiCredential &&
          geminiCredential.projectId
        ) {
          headers['x-goog-user-project'] = geminiCredential.projectId
        }
      }
    }

    if (isGithubCopilot) {
      Object.assign(headers, COPILOT_HEADERS)
    } else if (isGithubModels) {
      headers['Accept'] = 'application/vnd.github+json'
      headers['X-GitHub-Api-Version'] = '2022-11-28'
    }

    const buildChatCompletionsUrl = (baseUrl: string): string => {
      // Azure Cognitive Services / Azure OpenAI require a deployment-specific
      // path and an api-version query parameter.
      if (isAzure) {
        const apiVersion =
          process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview'
        const deployment =
          request.resolvedModel ?? process.env.OPENAI_MODEL ?? 'gpt-4o'

        // If base URL already contains /deployments/, use it as-is with api-version.
        if (/\/deployments\//i.test(baseUrl)) {
          const normalizedBase = baseUrl.replace(/\/+$/, '')
          return `${normalizedBase}/chat/completions?api-version=${apiVersion}`
        }

        // Strip trailing /v1 or /openai/v1 if present, then build Azure path.
        const normalizedBase = baseUrl
          .replace(/\/(openai\/)?v1\/?$/, '')
          .replace(/\/+$/, '')

        return `${normalizedBase}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
      }

      return `${baseUrl}/chat/completions`
    }

    const localRetryBaseUrls = isLocal
      ? getLocalProviderRetryBaseUrls(request.baseUrl)
      : []

    const buildRequestUrl = (baseUrl: string): string =>
      request.transport === 'responses'
        ? `${baseUrl}/responses`
        : buildChatCompletionsUrl(baseUrl)

    let activeBaseUrl = request.baseUrl
    let requestUrl = buildRequestUrl(activeBaseUrl)
    const attemptedLocalBaseUrls = new Set<string>([activeBaseUrl])
    let didRetryWithoutTools = false

    const promoteNextLocalBaseUrl = (
      reason: 'endpoint_not_found' | 'localhost_resolution_failed',
    ): boolean => {
      for (const candidateBaseUrl of localRetryBaseUrls) {
        if (attemptedLocalBaseUrls.has(candidateBaseUrl)) {
          continue
        }

        const previousUrl = requestUrl
        attemptedLocalBaseUrls.add(candidateBaseUrl)
        activeBaseUrl = candidateBaseUrl
        requestUrl = buildRequestUrl(activeBaseUrl)

        logForDebugging(
          `[OpenAIShim] self-heal retry reason=${reason} method=POST from=${redactUrlForDiagnostics(previousUrl)} to=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
          { level: 'warn' },
        )

        return true
      }

      return false
    }

    // WHY: byte-identity required for implicit prefix caching in
    // OpenAI/Kimi/DeepSeek. stableStringify sorts object keys at every
    // depth so spurious insertion-order differences across rebuilds of
    // `body` (spread-merge, conditional assignments above) don't bust
    // the provider's prefix hash.
    //
    // Local backends do not implement prefix caching, so the deep key-sort
    // is pure CPU overhead per request (issue #1016). Drop to the native
    // `JSON.stringify` fast path when the fast-path config opts out.
    const serializeBody = (): string => {
      const payload =
        request.transport === 'responses' ? buildResponsesBody() : body
      return fastPath.skipStableStringify
        ? JSON.stringify(payload)
        : stableStringifyJson(payload)
    }
    let serializedBody = serializeBody()

    const refreshSerializedBody = (): void => {
      serializedBody = serializeBody()
    }

    const buildFetchInit = () => ({
      method: 'POST' as const,
      headers,
      body: serializedBody,
      signal: options?.signal,
    })

    const maxSelfHealAttempts = isLocal ? localRetryBaseUrls.length + 1 : 0
    const maxAttempts =
      (isGithub ? GITHUB_429_MAX_RETRIES : 1) +
      maxSelfHealAttempts +
      (isVerbooRouterUrl(request.baseUrl) &&
      this.providerOverride?.refreshApiKey
        ? 1
        : 0)

    const throwClassifiedTransportError = (
      error: unknown,
      requestUrl: string,
      preclassifiedFailure?: ReturnType<typeof classifyOpenAINetworkFailure>,
    ): never => {
      if (options?.signal?.aborted) {
        throw error
      }

      const failure =
        preclassifiedFailure ??
        classifyOpenAINetworkFailure(error, {
          url: requestUrl,
        })
      const redactedUrl = redactUrlForDiagnostics(requestUrl)
      const safeMessage =
        redactSecretValueForDisplay(
          redactUrlsInMessage(failure.message),
          process.env as SecretValueSource,
        ) || 'Request failed'

      logForDebugging(
        `[OpenAIShim] transport failure category=${failure.category} retryable=${failure.retryable} code=${failure.code ?? 'unknown'} method=POST url=${redactedUrl} model=${request.resolvedModel} message=${safeMessage}`,
        { level: 'warn' },
      )

      throw APIError.generate(
        0,
        undefined,
        buildOpenAICompatibilityErrorMessage(
          `OpenAI API transport error: ${safeMessage}${failure.code ? ` (code=${failure.code})` : ''}`,
          failure,
        ),
        new Headers(),
      )
    }

    const throwClassifiedHttpError = (
      status: number,
      errorBody: string,
      parsedBody: object | undefined,
      responseHeaders: Headers,
      requestUrl: string,
      rateHint = '',
      preclassifiedFailure?: ReturnType<typeof classifyOpenAIHttpFailure>,
    ): never => {
      const failure =
        preclassifiedFailure ??
        classifyOpenAIHttpFailure({
          status,
          body: errorBody,
          url: requestUrl,
        })
      const failureWithUrl = {
        ...failure,
        requestUrl: failure.requestUrl ?? requestUrl,
      }
      const redactedUrl = redactUrlForDiagnostics(requestUrl)

      logForDebugging(
        `[OpenAIShim] request failed category=${failure.category} retryable=${failure.retryable} status=${status} method=POST url=${redactedUrl} model=${request.resolvedModel}`,
        { level: 'warn' },
      )

      throw APIError.generate(
        status,
        parsedBody,
        buildOpenAICompatibilityErrorMessage(
          `OpenAI API error ${status}: ${errorBody}${rateHint}`,
          failureWithUrl,
        ),
        responseHeaders,
      )
    }

    let response: Response | undefined
    const requestStartedAt = performance.now()
    let didRetryFreeTokenActivation = false
    let didRetryVerbooAuth = false
    const provider = request.baseUrl.includes('nvidia')
      ? 'nvidia-nim'
      : request.baseUrl.includes('minimax')
        ? 'minimax'
        : request.baseUrl.includes('xiaomimimo') ||
            request.baseUrl.includes('mimo-v2')
          ? 'xiaomi-mimo'
          : request.baseUrl.includes('localhost:11434') ||
              request.baseUrl.includes('localhost:11435')
            ? 'ollama'
            : request.baseUrl.includes('anthropic')
              ? 'anthropic'
              : 'openai'
    const { correlationId, startTime } = logApiCallStart(
      provider,
      request.resolvedModel,
    )
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        response = await fetchWithProxyRetry(requestUrl, buildFetchInit())
      } catch (error) {
        const isAbortError =
          options?.signal?.aborted === true ||
          (typeof DOMException !== 'undefined' &&
            error instanceof DOMException &&
            error.name === 'AbortError') ||
          (typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'AbortError')

        if (isAbortError) {
          throw error
        }

        const failure = classifyOpenAINetworkFailure(error, {
          url: requestUrl,
        })

        if (
          isLocal &&
          failure.category === 'localhost_resolution_failed' &&
          promoteNextLocalBaseUrl('localhost_resolution_failed')
        ) {
          continue
        }

        throwClassifiedTransportError(error, requestUrl, failure)
      }

      captureRouterRateLimit(response.headers, requestUrl)
      if (!didRetryFreeTokenActivation && response.status === 402 && isVerbooRouterUrl(request.baseUrl)) {
        const body = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null
        if (body?.error?.code === 'free_tokens_exhausted' || body?.error?.code === 'free_tokens_activation_pending') {
          didRetryFreeTokenActivation = true
          if (options?.signal?.aborted) throw options.signal.reason
          if (!await requestFreeTokenActivation({ requestStartedAt })) throw new FreeTokensRequiredError()
          if (options?.signal?.aborted) throw options.signal.reason
          // Only repeat this rejected HTTP request. No response or tool call
          // from the conversation is replayed by the activation flow.
          await response.body?.cancel()
          attempt--
          continue
        }
      }


      if (response.ok) {
        // Do not clone a response stream just to inspect usage. Fetch tees can
        // buffer the slower branch without a bound; the actual parser below
        // records usage while consuming the one authoritative body.
        logApiCallEnd(
          correlationId,
          startTime,
          request.resolvedModel,
          'success',
          0,
          0,
          Boolean(params.stream),
        )
        registerClientDiagnosticReporter(response, request.baseUrl, headers)
        return response
      }

      if (
        !didRetryVerbooAuth &&
        response.status === 401 &&
        isVerbooRouterUrl(request.baseUrl) &&
        this.providerOverride?.refreshApiKey
      ) {
        didRetryVerbooAuth = true
        const failedApiKey = getApiKey()
        await drainBoundedResponseBody(
          response,
          MAX_PROVIDER_ERROR_BODY_BYTES,
        )
        const refreshedApiKey =
          await this.providerOverride.refreshApiKey(failedApiKey)
        if (refreshedApiKey) {
          applyAuthHeader()
          continue
        }
      }

      if (isGithub && response.status === 429 && attempt < maxAttempts - 1) {
        await drainBoundedResponseBody(
          response,
          MAX_PROVIDER_ERROR_BODY_BYTES,
        )
        const delaySec = Math.min(
          GITHUB_429_BASE_DELAY_SEC * 2 ** attempt,
          GITHUB_429_MAX_DELAY_SEC,
        )
        await sleepMs(delaySec * 1000)
        continue
      }
      // Read body exactly once here — Response body is a stream that can only
      // be consumed a single time.
      const errorBody = await readProviderErrorBody(response)
      const rateHint =
        isGithub && response.status === 429
          ? formatRetryAfterHint(response)
          : ''

      // If GitHub Copilot returns error about /chat/completions,
      // try the /responses endpoint (needed for GPT-5+ models)
      if (isGithub && response.status === 400) {
        if (
          errorBody.includes('/chat/completions') ||
          errorBody.includes('not accessible')
        ) {
          const responsesUrl = `${request.baseUrl}/responses`
          const responsesBody = buildResponsesBody()

          let responsesResponse: Response
          try {
            responsesResponse = await fetchWithProxyRetry(responsesUrl, {
              method: 'POST',
              headers,
              body: stableStringifyJson(responsesBody),
              signal: options?.signal,
            })
          } catch (error) {
            throwClassifiedTransportError(error, responsesUrl)
          }

          captureRouterRateLimit(responsesResponse.headers, responsesUrl)

          if (responsesResponse.ok) {
            return responsesResponse
          }
          const responsesErrorBody = await readProviderErrorBody(
            responsesResponse,
          )
          const responsesFailure = classifyOpenAIHttpFailure({
            status: responsesResponse.status,
            body: responsesErrorBody,
          })
          let responsesErrorResponse: object | undefined
          try {
            responsesErrorResponse = JSON.parse(responsesErrorBody)
          } catch {
            /* raw text */
          }
          throwClassifiedHttpError(
            responsesResponse.status,
            responsesErrorBody,
            responsesErrorResponse,
            responsesResponse.headers,
            responsesUrl,
            '',
            responsesFailure,
          )
        }
      }

      const failure = classifyOpenAIHttpFailure({
        status: response.status,
        body: errorBody,
      })

      if (
        isLocal &&
        failure.category === 'endpoint_not_found' &&
        promoteNextLocalBaseUrl('endpoint_not_found')
      ) {
        continue
      }

      const hasToolsPayload =
        request.transport === 'responses'
          ? Array.isArray(params.tools) && params.tools.length > 0
          : Array.isArray(body.tools) && body.tools.length > 0

      if (
        !didRetryWithoutTools &&
        failure.category === 'tool_call_incompatible' &&
        shouldAttemptLocalToollessRetry({
          baseUrl: activeBaseUrl,
          hasTools: hasToolsPayload,
        })
      ) {
        didRetryWithoutTools = true
        delete body.tools
        delete body.tool_choice
        omitResponsesTools = true
        refreshSerializedBody()

        logForDebugging(
          `[OpenAIShim] self-heal retry reason=tool_call_incompatible mode=toolless method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
          { level: 'warn' },
        )
        continue
      }

      let errorResponse: object | undefined
      try {
        errorResponse = JSON.parse(errorBody)
      } catch {
        /* raw text */
      }
      throwClassifiedHttpError(
        response.status,
        errorBody,
        errorResponse,
        response.headers as unknown as Headers,
        requestUrl,
        rateHint,
        failure,
      )
    }

    throw APIError.generate(
      500,
      undefined,
      'OpenAI shim: request loop exited unexpectedly',
      new Headers(),
    )
  }

  private _convertNonStreamingResponse(
    data: {
      id?: string
      model?: string
      choices?: Array<{
        message?: {
          role?: string
          content?: string | null | Array<{ type?: string; text?: string }>
          reasoning_content?: string | null
          function_call?: { name: string; arguments: string }
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
            extra_content?: Record<string, unknown>
          }>
        }
        finish_reason?: string
      }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: {
          cached_tokens?: number
        }
      }
    },
    model: string,
    advertisedToolNames: readonly string[] = [],
    recoverableToolNames: readonly string[] = [],
  ) {
    const choice = data.choices?.[0]
    const toolArgumentCharsLimit = maxBufferedToolArgumentChars()
    if (
      !choice ||
      typeof choice.finish_reason !== 'string' ||
      !choice.finish_reason.trim()
    ) {
      throw new Error(
        'Upstream non-streaming response ended without a terminal choice; no output was committed.',
      )
    }
    const content: Array<Record<string, unknown>> = []

    // Some reasoning models (e.g. GLM-5) put their chain-of-thought in
    // reasoning_content while content stays null. Preserve it as a thinking
    // block, but do not surface it as visible assistant text.
    const reasoningText = choice?.message?.reasoning_content
    if (typeof reasoningText === 'string' && reasoningText) {
	  if (hasInvalidUnicodeScalar(reasoningText)) {
		throw new Error(
		  'Upstream reasoning contained an invalid Unicode scalar; no output was committed.',
		)
	  }
      content.push({ type: 'thinking', thinking: reasoningText })
    }
    const rawContent =
      choice?.message?.content !== '' && choice?.message?.content != null
        ? choice?.message?.content
        : null
    if (typeof rawContent === 'string' && rawContent) {
	  if (hasInvalidUnicodeScalar(rawContent)) {
		throw new Error(
		  'Upstream text contained an invalid Unicode scalar; no output was committed.',
		)
	  }
      content.push({
        type: 'text',
        text: stripThinkTags(rawContent),
      })
    } else if (Array.isArray(rawContent) && rawContent.length > 0) {
      const parts: string[] = []
      for (const part of rawContent) {
        if (
          part &&
          typeof part === 'object' &&
          part.type === 'text' &&
          typeof part.text === 'string'
        ) {
		  if (hasInvalidUnicodeScalar(part.text)) {
			throw new Error(
			  'Upstream text contained an invalid Unicode scalar; no output was committed.',
			)
		  }
          parts.push(part.text)
        }
      }
      const joined = parts.join('\n')
      if (joined) {
        content.push({
          type: 'text',
          text: stripThinkTags(joined),
        })
      }
    }

    const isToolFinish =
      choice?.finish_reason === 'tool_calls' ||
      choice?.finish_reason === 'function_call'
    const completedToolCalls: Array<{
      id: string
      function: { name: string; arguments: string }
      extra_content?: Record<string, unknown>
    }> = [
      ...(choice?.message?.tool_calls ?? []),
      ...(choice?.message?.function_call
        ? [
            {
              id: `${data.id ?? makeMessageId()}_function_call`,
              function: choice.message.function_call,
            },
          ]
        : []),
    ]
    if (isToolFinish) {
      if (completedToolCalls.length === 0) {
        throw new Error(
          'Upstream returned a tool finish reason without a tool call; no tool was committed.',
        )
      }
      const completedToolCallIds = new Set<string>()
      let completedToolArgumentChars = 0
      for (const tc of completedToolCalls) {
        const resolvedToolName =
          typeof tc.function?.name === 'string'
            ? resolveToolNameByUniquePrefix(
                advertisedToolNames,
                tc.function.name,
                recoverableToolNames,
              )
            : undefined
        if (
          typeof tc.id !== 'string' ||
          !tc.id.trim() ||
          hasInvalidUnicodeScalar(tc.id) ||
          typeof tc.function?.name !== 'string' ||
          !tc.function.name.trim() ||
          hasInvalidUnicodeScalar(tc.function.name) ||
          typeof tc.function?.arguments !== 'string' ||
          toolArgumentsContainInvalidUnicode(tc.function.arguments) ||
          tc.function.arguments.length > toolArgumentCharsLimit ||
          hasInvalidUnicodeScalarDeep(tc.extra_content) ||
          (advertisedToolNames.length > 0 && !resolvedToolName) ||
          hasInvalidToolArguments(
            tc.function.arguments,
            resolvedToolName ?? tc.function.name,
          ) ||
          completedToolCallIds.has(tc.id)
        ) {
          throw new Error(
            'Upstream returned malformed, incomplete, or duplicate tool calls; no tool was committed.',
          )
        }
        completedToolArgumentChars += tc.function.arguments.length
        if (
          completedToolArgumentChars > toolArgumentCharsLimit
        ) {
          throw new Error(
            'Upstream tool arguments exceeded the configured safety limit; no tool was committed.',
          )
        }
        completedToolCallIds.add(tc.id)
      }
      for (const tc of completedToolCalls) {
        const toolName =
          resolveToolNameByUniquePrefix(
            advertisedToolNames,
            tc.function.name,
            recoverableToolNames,
          ) ?? tc.function.name
        const input = normalizeToolArguments(
          toolName,
          tc.function.arguments,
        )
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: toolName,
          input,
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
          // Extract Gemini signature from extra_content
          ...((tc.extra_content?.google as any)?.thought_signature
            ? {
                signature: (tc.extra_content?.google as any)
                  .thought_signature,
              }
            : {}),
        })
      }
    } else if (completedToolCalls.length > 0) {
      logForDebugging(
        JSON.stringify({
          type: 'discarded_uncommitted_tool_calls',
          model,
          reason: `finish_reason:${choice?.finish_reason ?? 'missing'}`,
          count: completedToolCalls.length,
        }),
        { level: 'warn' },
      )
    }

    const stopReason =
      choice?.finish_reason === 'tool_calls' ||
      choice?.finish_reason === 'function_call'
        ? 'tool_use'
        : choice?.finish_reason === 'length'
          ? 'max_tokens'
          : 'end_turn'

    if (
      choice?.finish_reason === 'content_filter' ||
      choice?.finish_reason === 'safety'
    ) {
      content.push({
        type: 'text',
        text: '\n\n[Content blocked by provider safety filter]',
      })
    }

    return {
      id: data.id ?? makeMessageId(),
      type: 'message',
      role: 'assistant',
      content,
      model: data.model ?? model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: buildAnthropicUsageFromRawUsage(
        data.usage as unknown as Record<string, unknown> | undefined,
      ),
      ...(data.usage == null && { usageReported: false }),
      ...usagePresence(data.usage),
    }
  }
}

class OpenAIShimBeta {
  messages: OpenAIShimMessages
  reasoningEffort?: string

  constructor(
    defaultHeaders: Record<string, string>,
    reasoningEffort?: string,
    providerOverride?: ShimProviderOverride,
    suppressReasoningEffort = false,
  ) {
    this.messages = new OpenAIShimMessages(
      defaultHeaders,
      reasoningEffort,
      providerOverride,
      suppressReasoningEffort,
    )
    this.reasoningEffort = reasoningEffort
  }
}

export function createOpenAIShimClient(options: {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
  reasoningEffort?: string
  suppressReasoningEffort?: boolean
  providerOverride?: ShimProviderOverride
}): unknown {
  hydrateGeminiAccessTokenFromSecureStorage()
  hydrateGithubModelsTokenFromSecureStorage()
  hydrateOpenAIShimCompatibilityEnv()

  const beta = new OpenAIShimBeta(
    {
      ...(options.defaultHeaders ?? {}),
    },
    options.reasoningEffort,
    options.providerOverride,
    options.suppressReasoningEffort,
  )

  return {
    beta,
    messages: beta.messages,
  }
}

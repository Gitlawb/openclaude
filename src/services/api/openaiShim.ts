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
 *   OPENAI_API_KEYS=sk-a,sk-b         — optional comma-separated key pool for rotation
 *   OPENAI_AUTH_HEADER=api-key        — optional custom auth header name
 *   OPENAI_AUTH_HEADER_VALUE=...      — optional custom auth header value
 *   OPENAI_AUTH_SCHEME=bearer|raw     — auth scheme for Authorization/custom header handling
 *   OPENAI_API_FORMAT=chat_completions|responses — request format for compatible APIs
 *   OPENAI_BASE_URL=http://...        — base URL (default: https://api.openai.com/v1)
 *   OPENAI_MODEL=gpt-4o              — default model override
 *   CODEX_API_KEY / ~/.codex/auth.json — Codex auth for codexplan/codexspark
 *
 * Smart auto-routing (opt-in; startup defaults, overridden by settings.smartRouting):
 *   OPENCLAUDE_SMART_ROUTING=1|true   — route simple turns to a cheaper model
 *   OPENCLAUDE_SMART_ROUTING_SIMPLE=<key> — agentModels key or model id for simple turns
 *   OPENCLAUDE_SMART_ROUTING_STRONG=<key> — agentModels key or model id for strong turns
 *
 * GitHub Copilot API (api.githubcopilot.com), OpenAI-compatible:
 *   CLAUDE_CODE_USE_GITHUB=1         — enable GitHub inference (no need for USE_OPENAI)
 *   GITHUB_TOKEN or GH_TOKEN         — Copilot API token (mapped to Bearer auth)
 *   OPENAI_MODEL                     — optional; use github:copilot or openai/gpt-4.1 style IDs
 *
 * Azure OpenAI / Microsoft Foundry (OpenAI-compatible chat):
 *   AZURE_OPENAI_API_VERSION         — query param for chat/completions (default: 2024-12-01-preview)
 *   OPENAI_AZURE_STYLE=1             — force Azure deployment URL + api-key header when the hostname
 *                                     would not otherwise match (for example inference.ml.azure.com)
 */

import { APIError } from '@anthropic-ai/sdk'
import {
  readCodexCredentialsAsync,
  refreshCodexAccessTokenIfNeeded,
} from '../../utils/codexCredentials.js'
import { logForDebugging } from '../../utils/debug.js'
import { anthropicSsePassthrough as parseAnthropicSsePassthrough, createReaderCanceller, createStreamAbortError, getStreamIdleTimeoutMs, readWithIdleTimeout, StreamIdleTimeoutError, throwIfStreamAborted } from './openaiShim/streamControl.js'
export { getStreamIdleTimeoutMs } from './openaiShim/streamControl.js'
import { isBareMode, isEnvTruthy } from '../../utils/envUtils.js'
import {
  resolveModelReasoningControl,
  resolveOpenAIShimReasoningRequestPlan,
  type OpenAIShimEffortLevel,
} from '../../utils/effort.js'
import { resolveGeminiCredential } from '../../utils/geminiAuth.js'
import { hydrateGeminiAccessTokenFromSecureStorage } from '../../utils/geminiCredentials.js'
import {
  hydrateGithubModelsTokenFromSecureStorage,
  refreshCopilotTokenOn401,
} from '../../utils/githubModelsCredentials.js'
import { resolveXaiAccessToken } from '../../utils/xaiCredentials.js'
import {
  resolveModelRuntimeLimits,
  resolveOpenAIShimRuntimeContext,
} from '../../integrations/runtimeMetadata.js'
import {
  getRouteDescriptor,
  isLongcatBaseUrl,
  isXaiBaseUrl,
  resolveRouteCredentialValue,
} from '../../integrations/routeMetadata.js'
import { getSessionId } from '../../bootstrap/state.js'
import {
  createThinkTagFilter,
  stripThinkTags,
} from './thinkTagSanitizer.js'
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
import {
  createRequestBodyPlanner,
  hydrateOpenAIShimCompatibilityEnv as hydrateRequestPlanningEnv,
} from './openaiShim/requestPlanner.js'
import { buildAnthropicUsageFromRawUsage } from './cacheMetrics.js'
import {
  convertOpenAIStreamUsage,
  openaiStreamToAnthropic as convertOpenAIStream,
} from './openaiShim/streamConversion.js'
import { geminiSseToAnthropic as convertGeminiStream } from './openaiShim/geminiStreamConversion.js'
import { compressToolHistory } from './compressToolHistory.js'
import {
  fetchWithProxyRetry,
  type ProxyRetryFetcher,
} from './fetchWithProxyRetry.js'
import { executeOpenAIRequest } from './openaiShim/requestExecutor.js'
import {
  getLocalFastPathConfig,
  getLocalProviderRetryBaseUrls,
  getGithubEndpointType,
  baseUrlSupportsResponsesAutoRoute,
  isAzureStyleBaseUrl,
  isDirectLocalOllamaEndpoint,
  isLikelyOllamaEndpoint,
  isLocalProviderUrl,
  modelRequiresResponsesApi,
  resolveRuntimeCodexCredentials,
  resolveProviderRequest,
  shouldAttemptLocalToollessRetry,
  type LocalFastPathConfig,
} from './providerConfig.js'
import {
  buildOpenAICompatibilityErrorMessage,
  classifyOpenAIHttpFailure,
  classifyOpenAINetworkFailure,
  markOpenAIRequestNonReplayable,
} from './openaiErrorClassification.js'
import { redactSecretValueForDisplay, type SecretValueSource } from '../../utils/providerProfile.js'
import {
  redactEncodedSecretSubstringsForDisplay,
  redactSecretSubstringsForDisplay,
} from '../../utils/providerSecrets.js'
import {
  redactUrlForDisplay,
  shouldRedactUrlQueryParam,
} from '../../utils/redaction.js'
import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
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
import {
  findXmlToolCallOpener as findXmlToolCallOpenerModule,
  isHy3Model as isHy3ModelModule,
  parseXmlToolCalls as parseXmlToolCallsModule,
  trailingXmlOpenerPrefixLen as trailingXmlOpenerPrefixLenModule,
} from './openaiShim/xmlToolCallParsing.js'
import {
  convertNonStreamingResponseToAnthropicMessage as convertResponseToAnthropicMessage,
  type NonStreamingOpenAIResponse,
} from './openaiShim/responseConversion.js'
import {
  CredentialPool,
  type CredentialLease,
  hasInvalidCredentialPlaceholder,
  parseCredentialList,
} from './credentialPool.js'
import {
  filterAnthropicHeaders,
  geminiThoughtSignatureFromExtraContent,
  hasCerebrasApiHost,
  hasGeminiApiHost as matchesGeminiApiHost,
  hasMistralApiHost,
  isGithubModelsMode,
  isGeminiModelName,
  mergeGeminiThoughtSignature,
  maybeSetNvidiaNimChatTemplateThinking,
  shouldPreserveGeminiThoughtSignature as shouldPreserveGeminiThoughtSignatureForRoute,
} from './openaiShim/providerCompatibility.js'

export { hasMistralApiHost }
import {
  buildOllamaChatUrl,
  convertOllamaNonStreamingResponse,
  convertOllamaStreamingResponse,
  getOllamaNumCtx,
  normalizeOllamaNativeMessages,
} from './openaiShim/ollamaAdapter.js'
import {
  convertMessages as convertAnthropicMessages,
  convertSystemPrompt as convertSystemPromptImpl,
} from './openaiShim/messageConversion.js'
import {
  JSON_REPAIR_SUFFIXES,
  couldBeRawToolCallsRequestedPrefix,
  extractBalancedJson,
  parseRawToolCallsRequestedText,
  parseTextToolCalls as parseTextToolCallsModule,
  repairPossiblyTruncatedObjectJson,
  stripRanges,
  type ParsedRawToolCall,
  type ParsedTextToolCall,
} from './openaiShim/rawToolCallParsing.js'
import {
  convertTools as convertToolsModule,
  normalizeSchemaForOpenAI as normalizeSchemaForOpenAIModule,
} from './openaiShim/toolConversion.js'

const GITHUB_429_MAX_RETRIES = 3
const GITHUB_429_BASE_DELAY_SEC = 1
const GITHUB_429_MAX_DELAY_SEC = 32
const CREDENTIAL_POOL_COOLDOWN_MS = 30_000
const DEFAULT_API_TIMEOUT_MS = 600_000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000
const MAX_STREAM_IDLE_TIMEOUT_MS = 2_147_483_647
const GEMINI_API_HOST = 'generativelanguage.googleapis.com'
const COPILOT_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'Editor-Version': 'vscode/1.99.3',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
}

function isCopilotTokenExpiredError(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('token expired') || lower.includes('token has expired')
}

class ResponseHeadersTimeoutError extends Error {
  constructor(timeoutMs: number, url: string) {
    super(
      `OpenAI-compatible request received no response headers within ${timeoutMs}ms (API_TIMEOUT_MS) from ${url}`,
    )
    this.name = 'ResponseHeadersTimeoutError'
  }
}

function preserveCallerAbortError(
  error: unknown,
  callerSignal: AbortSignal,
): unknown {
  return error instanceof ResponseHeadersTimeoutError || isAbortError(error)
    ? callerSignal.reason ?? error
    : error
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError')
  )
}

export function getApiTimeoutMs(): number {
  const raw = process.env.API_TIMEOUT_MS?.trim()
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_API_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_STREAM_IDLE_TIMEOUT_MS)
    : DEFAULT_API_TIMEOUT_MS
}

function combineRequestSignals(
  callerSignal: AbortSignal | undefined,
  deadlineSignal: AbortSignal,
): {
  signal: AbortSignal
  cleanupAfterHeaders: () => void
  cleanup: () => void
  cleanupAfterBody?: () => void
} {
  if (!callerSignal) {
    return {
      signal: deadlineSignal,
      cleanupAfterHeaders: () => {},
      cleanup: () => {},
    }
  }

  if (typeof AbortSignal.any === 'function') {
    return {
      // The deadline controller is request-local and its timer is the only
      // abort source, so clearing that timer after headers permanently disarms it.
      signal: AbortSignal.any([callerSignal, deadlineSignal]),
      cleanupAfterHeaders: () => {},
      cleanup: () => {},
    }
  }

  const combined = new AbortController()
  const abortFromCaller = () => {
    deadlineSignal.removeEventListener('abort', abortFromDeadline)
    combined.abort(callerSignal.reason)
  }
  const abortFromDeadline = () => {
    callerSignal.removeEventListener('abort', abortFromCaller)
    combined.abort(deadlineSignal.reason)
  }
  const cleanupAfterHeaders = () => {
    deadlineSignal.removeEventListener('abort', abortFromDeadline)
  }
  const cleanup = () => {
    callerSignal.removeEventListener('abort', abortFromCaller)
    cleanupAfterHeaders()
  }

  callerSignal.addEventListener('abort', abortFromCaller, { once: true })
  deadlineSignal.addEventListener('abort', abortFromDeadline, { once: true })
  if (callerSignal.aborted) {
    abortFromCaller()
  } else if (deadlineSignal.aborted) {
    abortFromDeadline()
  }

  return {
    signal: combined.signal,
    cleanupAfterHeaders,
    cleanup,
    cleanupAfterBody: cleanup,
  }
}

function wrapResponseBodyWithCleanup(
  response: Response,
  cleanup: () => void,
): Response {
  if (!response.body) {
    cleanup()
    return response
  }

  const reader = response.body.getReader()
  let cleanedUp = false
  const cleanupOnce = () => {
    if (cleanedUp) return
    cleanedUp = true
    cleanup()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          cleanupOnce()
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        cleanupOnce()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        cleanupOnce()
      }
    },
  })
  const wrapped = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  for (const property of ['url', 'type', 'redirected'] as const) {
    try {
      Object.defineProperty(wrapped, property, {
        value: response[property],
        configurable: true,
      })
    } catch {
      /* non-fatal: standard response metadata remains available */
    }
  }
  return wrapped
}

async function fetchWithHeadersDeadline(
  url: string,
  init: RequestInit,
  options: {
    callerSignal?: AbortSignal
    timeoutMs: number
  },
): Promise<Response> {
  const redactedUrl = redactUrlForDiagnostics(url)
  const fetchWithAttemptDeadline: ProxyRetryFetcher = async (input, attemptInit) => {
    const deadlineController = new AbortController()
    const timeoutReason = new ResponseHeadersTimeoutError(
      options.timeoutMs,
      redactedUrl,
    )
    const {
      signal,
      cleanupAfterHeaders,
      cleanup,
      cleanupAfterBody,
    } = combineRequestSignals(options.callerSignal, deadlineController.signal)
    const timer = setTimeout(
      () => deadlineController.abort(timeoutReason),
      options.timeoutMs,
    )
    timer.unref?.()

    let headersReceived = false
    try {
      const response = await fetch(input, { ...attemptInit, signal })
      if (signal.aborted) {
        void response.body?.cancel().catch(() => {})
        throw (
          signal.reason ??
          new DOMException('The operation was aborted.', 'AbortError')
        )
      }
      headersReceived = true
      return cleanupAfterBody
        ? wrapResponseBodyWithCleanup(response, cleanupAfterBody)
        : response
    } catch (error) {
      if (options.callerSignal?.aborted) {
        throw preserveCallerAbortError(error, options.callerSignal)
      }
      if (
        deadlineController.signal.aborted &&
        deadlineController.signal.reason === timeoutReason
      ) {
        throw timeoutReason
      }
      throw error
    } finally {
      clearTimeout(timer)
      if (headersReceived) {
        cleanupAfterHeaders()
      } else {
        cleanup()
      }
    }
  }

  return fetchWithProxyRetry(
    url,
    { ...init, signal: options.callerSignal },
    { fetcher: fetchWithAttemptDeadline },
  )
}

function hasGeminiApiHost(baseUrl: string | undefined): boolean {
  return matchesGeminiApiHost(baseUrl, GEMINI_API_HOST)
}

function shouldPreserveGeminiThoughtSignature(
  model: string | undefined,
  baseUrl?: string,
): boolean {
  return shouldPreserveGeminiThoughtSignatureForRoute(
    model,
    baseUrl,
    isGeminiMode(),
    GEMINI_API_HOST,
  )
}

function formatRetryAfterHint(response: Response): string {
  const ra = response.headers.get('retry-after')
  return ra ? ` (Retry-After: ${ra})` : ''
}

function decodeValidPercentRun(encoded: string): string {
  const escapes = encoded.match(/%[0-9A-Fa-f]{2}/g)
  if (!escapes) return encoded

  let decoded = ''
  let offset = 0
  while (offset < escapes.length) {
    const firstByte = Number.parseInt(escapes[offset].slice(1), 16)
    const sequenceLength =
      firstByte <= 0x7f
        ? 1
        : firstByte >= 0xc2 && firstByte <= 0xdf
          ? 2
          : firstByte >= 0xe0 && firstByte <= 0xef
            ? 3
            : firstByte >= 0xf0 && firstByte <= 0xf4
              ? 4
              : 1
    try {
      decoded += decodeURIComponent(
        escapes.slice(offset, offset + sequenceLength).join(''),
      )
      offset += sequenceLength
    } catch {
      decoded += escapes[offset]
      offset++
    }
  }
  return decoded
}

function decodeValidUrlEscapesOnce(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, decodeValidPercentRun)
}

const MAX_URL_SECRET_DECODING_LAYERS = 4

function redactDecodedUrlComponentSecrets(value: string): string {
  let decoded = value
  let foundSecret = false
  for (let layer = 0; layer <= MAX_URL_SECRET_DECODING_LAYERS; layer++) {
    const redacted =
      redactSecretSubstringsForDisplay(
        decoded,
        process.env as SecretValueSource,
      ) ?? decoded
    if (redacted !== decoded) foundSecret = true
    if (layer === MAX_URL_SECRET_DECODING_LAYERS) {
      decoded = redacted
      break
    }
    const next = decodeValidUrlEscapesOnce(redacted)
    if (next === redacted) {
      decoded = redacted
      break
    }
    decoded = next
  }
  return foundSecret ? decoded : value
}

function redactUrlForDiagnostics(url: string): string {
  let redacted = redactUrlForDisplay(url)
  try {
    const parsed = new URL(redacted)
    const redactedPathname = redactDecodedUrlComponentSecrets(parsed.pathname)
    const redactedSearch = redactDecodedUrlComponentSecrets(parsed.search)
    let componentRedacted = false
    if (redactedPathname !== parsed.pathname) {
      parsed.pathname = redactedPathname
      componentRedacted = true
    }
    if (redactedSearch !== parsed.search) {
      parsed.search = redactedSearch
      componentRedacted = true
    }
    if (componentRedacted) redacted = parsed.toString()
  } catch {
    // Keep the URL-level redaction when the URL cannot be parsed.
  }
  const redactedSubstrings =
    redactSecretSubstringsForDisplay(
      redacted,
      process.env as SecretValueSource,
    ) ?? redacted
  return (
    redactSecretValueForDisplay(
      redactedSubstrings,
      process.env as SecretValueSource,
    ) ?? redactedSubstrings
  )
}

function redactUrlsInMessage(message: string): string {
  return message.replace(/https?:\/\/\S+/g, match => redactUrlForDiagnostics(match))
}

function createClassifiedTransportError(
  error: unknown,
  requestUrl: string,
  model: string,
  preclassifiedFailure?: ReturnType<typeof classifyOpenAINetworkFailure>,
) {
  const failure =
    preclassifiedFailure ??
    classifyOpenAINetworkFailure(error, {
      url: requestUrl,
    })
  const redactedUrl = redactUrlForDiagnostics(requestUrl)
  const encodedSecretRedactedMessage =
    redactEncodedSecretSubstringsForDisplay(
      redactUrlsInMessage(failure.message),
      process.env as SecretValueSource,
    ) ?? 'Request failed'
  const redactedMessage =
    redactSecretSubstringsForDisplay(
      encodedSecretRedactedMessage,
      process.env as SecretValueSource,
    ) ?? 'Request failed'
  const safeMessage =
    redactSecretValueForDisplay(
      redactedMessage,
      process.env as SecretValueSource,
    ) || 'Request failed'

  logForDebugging(
    `[OpenAIShim] transport failure category=${failure.category} retryable=${failure.retryable} code=${failure.code ?? 'unknown'} method=POST url=${redactedUrl} model=${model} message=${safeMessage}`,
    { level: 'warn' },
  )

  const apiError = APIError.generate(
    0,
    undefined,
    buildOpenAICompatibilityErrorMessage(
      `OpenAI API transport error: ${safeMessage}${failure.code ? ` (code=${failure.code})` : ''}`,
      failure,
    ),
    new Headers(),
  )
  return failure.retryable
    ? apiError
    : markOpenAIRequestNonReplayable(apiError)
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Types — minimal subset of Anthropic SDK types we need to produce
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Message format conversion: Anthropic → OpenAI
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAIContentPart[]
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

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

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
  return convertSystemPromptImpl(system)
}

function contentBlocksContainImages(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (!block || typeof block !== 'object') return false
    const record = block as Record<string, unknown>
    if (
      record.type === 'image' ||
      record.type === 'image_url' ||
      record.type === 'input_image'
    ) return true
    return record.type === 'tool_result' && contentBlocksContainImages(record.content)
  })
}

function requestBodyContainsImages(
  payload: Record<string, unknown> | undefined,
): boolean {
  if (!payload) return false
  const messages = payload.messages
  if (Array.isArray(messages) && messages.some(message => {
    if (!message || typeof message !== 'object') return false
    const record = message as Record<string, unknown>
    return contentBlocksContainImages(record.content) ||
      (Array.isArray(record.images) && record.images.length > 0)
  })) return true
  const input = payload.input
  if (Array.isArray(input) && input.some(item =>
    item && typeof item === 'object' &&
    contentBlocksContainImages((item as Record<string, unknown>).content),
  )) return true
  const contents = payload.contents
  return Array.isArray(contents) && contents.some(item => {
    if (!item || typeof item !== 'object') return false
    const parts = (item as Record<string, unknown>).parts
    return Array.isArray(parts) && parts.some(part => {
      if (!part || typeof part !== 'object') return false
      const record = part as Record<string, unknown>
      return ['inlineData', 'fileData'].some(key => {
        const data = record[key]
        if (!data || typeof data !== 'object') return false
        const mimeType = (data as Record<string, unknown>).mimeType
        return typeof mimeType === 'string' &&
          mimeType.trim().toLowerCase().startsWith('image/')
      })
    })
  })
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
  hydrateRequestPlanningEnv(processEnv, {
    isEnvTruthy,
    resolveRouteCredentialValue,
  })
}

function convertMessages(
  messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>,
  system: unknown,
  options?: {
    preserveReasoningContent?: boolean
    reasoningContentFallback?: '' | 'omit'
    preserveGeminiThoughtSignature?: boolean
    supportsImageInputs?: boolean
  },
): OpenAIMessage[] {
  return convertAnthropicMessages(messages, system, {
    ...options,
    getGeminiThoughtSignature: geminiThoughtSignatureFromExtraContent,
    mergeGeminiThoughtSignature,
    log: message => logForDebugging(message),
  })
}
function getChatMessagesForTransport<T>(
  transport: string,
  convert: () => T,
): T | undefined {
  return transport === 'chat_completions' ? convert() : undefined
}

function getCompressedMessagesForTransport<T>(
  transport: string,
  rawMessages: T,
  compress: () => T,
): T {
  return transport === 'chat_completions' ||
    transport === 'responses' ||
    transport === 'responses_compat'
    ? compress()
    : rawMessages
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
  return normalizeSchemaForOpenAIModule(schema, strict)
}

function convertTools(
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>,
  options: { skipStrict?: boolean } = {},
): OpenAITool[] {
  return convertToolsModule(tools, {
    isGemini: isGeminiMode(),
    disableStrictTools: isEnvTruthy(process.env.OPENCLAUDE_DISABLE_STRICT_TOOLS),
    skipStrict: options.skipStrict,
    normalizeSchema: normalizeSchemaForOpenAI,
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
      extra_content?: Record<string, unknown>
      tool_calls?: Array<{
        index: number
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

function makeMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '')}`
}

function convertChunkUsage(usage: OpenAIStreamChunk['usage'] | undefined): Partial<AnthropicUsage> | undefined {
  return convertOpenAIStreamUsage(usage as Record<string, unknown> | undefined)
}

export function parseTextToolCalls(text: string): {
  calls: ParsedTextToolCall[]
  toolCallRanges: Array<[number, number]>
} {
  return parseTextToolCallsModule(text, nextTextToolCallSequence)
}

// Shared façade state keeps raw-text and XML fallback IDs unique per session.
let textToolCallSequence = 0

function nextTextToolCallSequence(): number {
  return ++textToolCallSequence
}

// ---------------------------------------------------------------------------
// XML tool parsing façade. Dialect handling lives in xmlToolCallParsing.ts.
// ---------------------------------------------------------------------------

function findXmlToolCallOpener(text: string, allowHy3: boolean): number {
  return findXmlToolCallOpenerModule(text, allowHy3)
}

function isHy3Model(model: string): boolean {
  return isHy3ModelModule(model)
}

export function parseXmlToolCalls(text: string, allowHy3 = false) {
  return parseXmlToolCallsModule(text, allowHy3, nextTextToolCallSequence)
}

function trailingXmlOpenerPrefixLen(text: string, allowHy3: boolean): number {
  return trailingXmlOpenerPrefixLenModule(text, allowHy3)
}

// The streaming finalize path buffers from this opener onward so the raw XML
// is never surfaced as text before extraction.
/**
 * Async generator that transforms an OpenAI SSE stream into
 * Anthropic-format BetaRawMessageStreamEvent objects.
 */
/**
 * Passthrough for Anthropic Messages API SSE streams.
 * The response events are already in AnthropicStreamEvent format —
 * we just parse the SSE frames and yield them directly.
 */
async function* anthropicSsePassthrough(
  response: Response,
  _model: string,
  signal?: AbortSignal,
): AsyncGenerator<AnthropicStreamEvent> {
  yield* parseAnthropicSsePassthrough<AnthropicStreamEvent>(
    response,
    signal,
    (message, options) => options?.level
      ? logForDebugging(message, { level: options.level })
      : logForDebugging(message),
  )
}

/**
 * Transforms Google AI SDK SSE stream into Anthropic-format stream events.
 * Google AI SDK yields frames with { candidates: [{ content: { role, parts } }] }.
 */
async function* geminiSseToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
): AsyncGenerator<AnthropicStreamEvent> {
  yield* convertGeminiStream(response, model, signal, {
    createReaderCanceller,
    createStreamAbortError,
    getStreamIdleTimeoutMs,
    makeMessageId,
    readWithIdleTimeout,
    throwIfStreamAborted,
  })
}
// Extraction seam: Gemini streaming | completed response conversion.

function convertNonStreamingResponseToAnthropicMessage(
  data: NonStreamingOpenAIResponse,
  model: string,
) {
  return convertResponseToAnthropicMessage(data, model, {
    makeMessageId,
    buildUsage: usage => buildAnthropicUsageFromRawUsage(usage),
    stripThinkTags,
    parseXmlToolCalls,
    isHy3Model,
    stripRanges,
    parseRawToolCalls: parseRawToolCallsRequestedText,
    normalizeToolArguments,
    getGeminiThoughtSignature: geminiThoughtSignatureFromExtraContent,
    mergeGeminiThoughtSignature,
  })
}

import { headersWithRequestUrl as buildHeadersWithRequestUrl } from './openaiShim/clientDispatch.js'

function headersWithRequestUrl(headers: Headers, requestUrl?: string): Headers {
  return buildHeadersWithRequestUrl(headers, requestUrl)
}

// Extraction seam: response metadata | generic stream conversion.

async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
  isOllama = false,
  requestUrl?: string,
): AsyncGenerator<AnthropicStreamEvent> {
  yield* convertOpenAIStream(response, model, signal, isOllama, requestUrl, {
    convertNonStreamingResponseToAnthropicMessage: (data, streamModel) =>
      convertNonStreamingResponseToAnthropicMessage(
        data as NonStreamingOpenAIResponse,
        streamModel,
      ),
    couldBeRawToolCallsRequestedPrefix,
    createReaderCanceller,
    createStreamAbortError,
    findXmlToolCallOpener,
    geminiThoughtSignatureFromExtraContent,
    getStreamIdleTimeoutMs,
    headersWithRequestUrl,
    isHy3Model,
    makeMessageId,
    mergeGeminiThoughtSignature,
    parseRawToolCallsRequestedText,
    parseTextToolCalls,
    parseXmlToolCalls,
    readWithIdleTimeout,
    repairPossiblyTruncatedObjectJson,
    stripRanges,
    throwIfStreamAborted,
    trailingXmlOpenerPrefixLen,
  })
}


// Extraction seam: stream conversion | stream lifecycle façade.

// ---------------------------------------------------------------------------
// The shim client — duck-types as Anthropic SDK
// ---------------------------------------------------------------------------

import { createShimRequest } from './openaiShim/clientDispatch.js'

class OpenAIShimMessages {
  private defaultHeaders: Record<string, string>
  private reasoningEffort?: OpenAIShimEffortLevel
  private providerOverride?: { model: string; baseURL: string; apiKey: string }
  private credentialPool?: CredentialPool
  private credentialPoolRaw?: string

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: OpenAIShimEffortLevel, providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.defaultHeaders = filterAnthropicHeaders(defaultHeaders)
    this.reasoningEffort = reasoningEffort
    this.providerOverride = providerOverride
  }

  private getCredentialPool(raw: string): CredentialPool | null {
    const credentials = parseCredentialList(raw)
    if (credentials.length === 0) {
      this.credentialPool = undefined
      this.credentialPoolRaw = undefined
      return null
    }

    if (!this.credentialPool || this.credentialPoolRaw !== raw) {
      this.credentialPool = new CredentialPool(credentials)
      this.credentialPoolRaw = raw
    }

    return this.credentialPool
  }

  create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const requestProcessEnv = this.providerOverride
      ? { ...process.env, OPENAI_AZURE_STYLE: undefined }
      : process.env
    return createShimRequest(params, options, {
      providerOverride: this.providerOverride,
      reasoningEffort: this.reasoningEffort,
      processEnv: requestProcessEnv,
      doRequest: this._doRequest.bind(this),
      convertNonStreamingResponse: this._convertNonStreamingResponse.bind(this),
      convertGeminiResponse: this._convertGeminiToAnthropicResponse.bind(this),
      codexStreamToAnthropic,
      collectCodexCompletedResponse,
      convertCodexResponseToAnthropicMessage,
      createStreamAbortError,
      anthropicSsePassthrough,
      geminiSseToAnthropic,
      openaiStreamToAnthropic,
      isGithubModelsMode,
      makeMessageId,
    })
  }
  private async _doRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
    requestProcessEnv: NodeJS.ProcessEnv = process.env,
  ): Promise<Response> {
    const githubEndpointType = getGithubEndpointType(request.baseUrl)
    const isGithubMode = isGithubModelsMode()
    const isGithubCopilotEndpoint = isGithubMode && (githubEndpointType === 'copilot' || githubEndpointType === 'ghe')
    const isGithubWithCodexTransport = isGithubCopilotEndpoint && request.transport === 'codex_responses'

    if (isGithubWithCodexTransport) {
      const apiTimeoutMs = getApiTimeoutMs()
      const responsesUrl = `${request.baseUrl}/responses`
      let didRefreshCopilotCodexToken = false
      let refreshedCopilotCodexToken: string | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const apiKey = refreshedCopilotCodexToken ?? this.providerOverride?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
        if (!apiKey) {
          throw new Error(
            'GitHub Copilot auth is required. Run /onboard-github to sign in.',
          )
        }

        try {
          try {
            return await performCodexRequest({
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
              fetcher: (input, init) => {
                const url =
                  typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url
                return fetchWithHeadersDeadline(url, init ?? {}, {
                  callerSignal: options?.signal,
                  timeoutMs: apiTimeoutMs,
                })
              },
            })
          } catch (error) {
            if (options?.signal?.aborted) {
              throw preserveCallerAbortError(error, options.signal)
            }
            if (error instanceof ResponseHeadersTimeoutError) {
              const failure = {
                ...classifyOpenAINetworkFailure(error, {
                  url: responsesUrl,
                }),
                retryable: false,
              }
              throw createClassifiedTransportError(
                error,
                responsesUrl,
                request.resolvedModel,
                failure,
              )
            }
            throw error
          }
        } catch (error) {
          if (
            !didRefreshCopilotCodexToken &&
            error instanceof APIError &&
            error.status === 401
          ) {
            if (
              apiKey === (process.env.OPENAI_API_KEY ?? '') &&
              isCopilotTokenExpiredError(error.message)
            ) {
              didRefreshCopilotCodexToken = true
              const refreshed = await refreshCopilotTokenOn401()
              if (refreshed) {
                const newApiKey = process.env.OPENAI_API_KEY?.trim() || ''
                if (newApiKey && newApiKey !== apiKey) {
                  refreshedCopilotCodexToken = newApiKey
                  continue
                }
              }
            }
          }
          throw error
        }
      }
    }

    if (request.transport === 'codex_responses' && !isGithubMode) {
      const refreshResult = await refreshCodexAccessTokenIfNeeded().catch(
        async error => {
          logForDebugging(
            `[codex] access token refresh failed before request: ${error instanceof Error ? error.message : String(error)}`,
            { level: 'warn' },
          )
          return {
            refreshed: false,
            credentials: await readCodexCredentialsAsync(),
          }
        },
      )
      const credentials = resolveRuntimeCodexCredentials({
        storedCredentials: refreshResult.credentials,
      })
      if (!credentials.apiKey) {
        const oauthHint = isBareMode() ? '' : ', choose Codex OAuth in /provider'
        const authHint = credentials.authPath
          ? `${oauthHint} or place a Codex auth.json at ${credentials.authPath}`
          : oauthHint
        const safeModel =
          redactSecretValueForDisplay(request.requestedModel, process.env as SecretValueSource) ??
          'the requested model'
        throw new Error(
          `Codex auth is required for ${safeModel}. Set CODEX_API_KEY${authHint}.`,
        )
      }
      if (!credentials.accountId) {
        throw new Error(
          'Codex auth is missing chatgpt_account_id. Re-login with Codex OAuth, the Codex CLI, or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.',
        )
      }

      return performCodexRequest({
        request,
        credentials,
        params,
        defaultHeaders: {
          ...this.defaultHeaders,
          ...filterAnthropicHeaders(options?.headers),
        },
        signal: options?.signal,
      })
    }

    return this._doOpenAIRequest(request, params, options, requestProcessEnv)
  }

  private async _doOpenAIRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
    requestProcessEnv: NodeJS.ProcessEnv = process.env,
  ): Promise<Response> {
    const apiTimeoutMs = getApiTimeoutMs()
    // Local backends (llama.cpp, vLLM, Ollama, LM Studio, …) do not implement
    // the cloud-side caching/strict-validation behaviours that several of our
    // pre-send transforms target. Computing the fast-path config once here
    // lets us skip those transforms uniformly. See providerConfig.ts.
    const fastPath: LocalFastPathConfig = getLocalFastPathConfig(request.baseUrl)

    const rawMessages = params.messages as Array<{
      role: string
      message?: { role?: string; content?: unknown }
      content?: unknown
    }>
    const runtimeModel = request.requestedModel
    const runtimeShimContext = resolveOpenAIShimRuntimeContext({
      processEnv: requestProcessEnv,
      baseUrl: request.baseUrl,
      model: runtimeModel,
      treatAsLocal: isLocalProviderUrl(request.baseUrl),
      preferBaseUrlRoute: Boolean(this.providerOverride),
    })
    const runtimeLimits = resolveModelRuntimeLimits({
      model: runtimeModel,
      baseUrl: request.baseUrl,
      processEnv: requestProcessEnv,
      activeProfileProvider: runtimeShimContext.routeId ?? undefined,
    })
    const shimConfig = runtimeShimContext.openaiShimConfig
    // When endpointPath is overridden, the body format must match the target
    // API contract rather than request.transport from providerConfig.
    // - /responses         → OpenAI Responses API (input, max_output_tokens, instructions)
    // - /messages          → Anthropic Messages API (system, max_tokens, content blocks)
    // - /models/gemini-*   → Google AI SDK (contents, systemInstruction, generationConfig)
    const effectiveTransport = shimConfig.endpointPath === '/responses'
      ? 'responses'
      : shimConfig.endpointPath === '/messages'
        ? 'anthropic_messages'
        : shimConfig.endpointPath?.startsWith('/models/gemini-')
          ? 'gemini'
          : request.transport
    const compressedMessages = getCompressedMessagesForTransport(
      effectiveTransport,
      rawMessages,
      () => fastPath.skipToolHistoryCompression
        ? rawMessages
        : compressToolHistory(rawMessages, runtimeModel, {
          textBlockSeparator:
            effectiveTransport === 'chat_completions' ? '\n\n' : '\n',
          runtimeLimits,
        }),
    )
    const useNativeOllamaChat =
      effectiveTransport === 'chat_completions' &&
      !shimConfig.endpointPath &&
      isDirectLocalOllamaEndpoint(request.baseUrl) &&
      isLikelyOllamaEndpoint(request.baseUrl)
    const openaiMessages = getChatMessagesForTransport(
      effectiveTransport,
      () => convertMessages(compressedMessages, params.system, {
        preserveReasoningContent: shimConfig.preserveReasoningContent,
        reasoningContentFallback: shimConfig.reasoningContentFallback,
        preserveGeminiThoughtSignature: shouldPreserveGeminiThoughtSignature(
          request.resolvedModel,
          request.baseUrl,
        ),
        supportsImageInputs: shimConfig.supportsImageInputs,
      }),
    )

    const reasoningControl = resolveModelReasoningControl(runtimeModel, {
      routeId: runtimeShimContext.routeId,
      useRuntimeFallback: false,
      openaiShimConfig: shimConfig,
      baseUrl: request.baseUrl,
      processEnv: requestProcessEnv,
    })
    // The explicit chat-completions escape hatch for GPT-5.4/5.5/5.6 must
    // also omit reasoning effort: these models reject the tools + effort
    // combination on that API surface.
    const suppressReasoningForForcedChat =
      effectiveTransport === 'chat_completions' &&
      Array.isArray(params.tools) &&
      params.tools.length > 0 &&
      modelRequiresResponsesApi(request.resolvedModel) &&
      baseUrlSupportsResponsesAutoRoute(request.baseUrl, requestProcessEnv)
    const reasoningRequestPlan = resolveOpenAIShimReasoningRequestPlan({
      model: runtimeModel,
      requestedEffort: suppressReasoningForForcedChat ? undefined : request.reasoning?.effort,
      requestThinkingType: (params.thinking as { type?: string } | undefined)?.type,
      defaultThinkingType: request.thinking?.type,
      thinkingRequestFormat: shimConfig.thinkingRequestFormat,
      routeId: runtimeShimContext.routeId ?? 'custom',
      useRuntimeFallback: false,
      reasoningControl,
    })

    const body: Record<string, unknown> = {
      model: request.resolvedModel,
      ...(openaiMessages ? { messages: openaiMessages } : {}),
      stream: params.stream ?? false,
      store: false,
    }
    // Emit reasoning_effort for chat_completions when the resolved provider
     // request carries a reasoning effort (set via /effort, model alias default,
     // or `?reasoning=<level>` query on the model string). OpenAI, Codex, and
     // most OpenAI-compatible endpoints read it from this top-level field.
    if (reasoningRequestPlan.wireFormat === 'reasoning_effort' && reasoningRequestPlan.reasoningEffort) {
      body.reasoning_effort = reasoningRequestPlan.reasoningEffort
    }
    if (
      reasoningRequestPlan.wireFormat === 'reasoning_effort' &&
      reasoningRequestPlan.thinkingType === 'disabled'
    ) {
      body.thinking = { type: 'disabled' }
      delete body.reasoning_effort
    }
    // Convert max_tokens to max_completion_tokens for OpenAI API compatibility.
    // Azure OpenAI requires max_completion_tokens and does not accept max_tokens.
    // Ensure max_tokens is a valid positive number before using it.
    const maxTokensValue = typeof params.max_tokens === 'number' && params.max_tokens > 0
      ? params.max_tokens
      : undefined
    const maxCompletionTokensValue = typeof (params as Record<string, unknown>).max_completion_tokens === 'number'
      ? (params as Record<string, unknown>).max_completion_tokens as number
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
    const isGithubCopilot = isGithub && (githubEndpointType === 'copilot' || githubEndpointType === 'ghe')
    const isGithubModels = isGithub && (githubEndpointType === 'models' || githubEndpointType === 'custom')
    const shouldStripResponsesStore =
      (shimConfig.removeBodyFields ?? []).includes('store') ||
      isGeminiMode() ||
      hasGeminiApiHost(request.baseUrl) ||
      hasCerebrasApiHost(request.baseUrl) ||
      hasMistralApiHost(request.baseUrl) ||
      isLocal

    // Mistral's chat completions reject `max_completion_tokens` (and `store`).
    // When the route resolves to the Mistral descriptor the config already maps
    // to `max_tokens`; on the host-detected fallback (`hasMistralApiHost`) the
    // generic default leaves `max_completion_tokens`, so map it here too.
    if (
      (shimConfig.maxTokensField === 'max_tokens' ||
        hasMistralApiHost(request.baseUrl)) &&
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

    if (reasoningRequestPlan.wireFormat === 'deepseek_compatible') {
      if (reasoningRequestPlan.thinkingType) {
        body.thinking = { type: reasoningRequestPlan.thinkingType }
      }
      if (reasoningRequestPlan.reasoningEffort) {
        body.reasoning_effort = reasoningRequestPlan.reasoningEffort
      }
      maybeSetNvidiaNimChatTemplateThinking(body, request.baseUrl, reasoningRequestPlan)
    }

    if (reasoningRequestPlan.wireFormat === 'zai_compatible') {
      if (reasoningRequestPlan.thinkingType) {
        body.thinking = { type: reasoningRequestPlan.thinkingType }
      }
      if (reasoningRequestPlan.thinkingType === 'disabled') {
        delete body.reasoning_effort
      } else if (reasoningRequestPlan.reasoningEffort) {
        body.reasoning_effort = reasoningRequestPlan.reasoningEffort
      } else {
        delete body.reasoning_effort
      }
      maybeSetNvidiaNimChatTemplateThinking(body, request.baseUrl, reasoningRequestPlan)
    }

    // Route/model strip rules are authoritative even when compatibility
    // serializers add provider-specific reasoning fields later in the pipeline.
    for (const field of shimConfig.removeBodyFields ?? []) {
      delete body[field]
    }

    if (
      !(shimConfig.removeBodyFields ?? []).includes('tools') &&
      params.tools &&
      params.tools.length > 0
    ) {
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
        if (
          effectiveTransport === 'chat_completions' &&
          params.stream &&
          shimConfig.enableToolStreaming === true
        ) {
          body.tool_stream = true
        }
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

    let responsesInput: ReturnType<
      typeof convertAnthropicMessagesToResponsesInput
    > | undefined
    let responsesMessages: typeof compressedMessages | undefined
    const getResponsesInput = () => {
      // GitHub can reject a Chat request and retry it through Responses. That
      // retry must budget structured text with the Responses separator rather
      // than reusing the Chat-compressed form (which uses a double newline).
      responsesMessages ??= effectiveTransport === 'chat_completions'
        ? fastPath.skipToolHistoryCompression
          ? rawMessages
          : compressToolHistory(rawMessages, request.resolvedModel, {
            textBlockSeparator: '\n',
          })
        : compressedMessages
      responsesInput ??= convertAnthropicMessagesToResponsesInput(
        responsesMessages,
        effectiveTransport === 'responses_compat',
      )
      return responsesInput
    }

    const omitTools = {
      responses: false,
      anthropic: false,
      gemini: false,
    }
    const planner = createRequestBodyPlanner({
      request, params, effectiveTransport, shouldStripResponsesStore, body,
      reasoningRequestPlan, shimConfig, getResponsesInput, convertSystemPrompt,
      convertToolsToResponsesTools, maxTokensValue, maxCompletionTokensValue,
      getOllamaNumCtx, normalizeOllamaNativeMessages, useNativeOllamaChat,
      fastPath, stableStringifyJson, omitTools,
    })
    const { buildResponsesBody, serializeBody } = planner

    // Extraction boundary: request planning | request execution.
    // The prepared body builders above are executor inputs, not executor-owned logic.
    // Keep this marker stable so either extraction can merge independently.
    return executeOpenAIRequest({
      defaultHeaders: this.defaultHeaders,
      providerOverride: this.providerOverride,
      routeAcceptsGenericOpenAICredentials:
        runtimeShimContext.routeId === null ||
        getRouteDescriptor(runtimeShimContext.routeId)?.setup
          .dedicatedCredentialsOnly !== true,
      getCredentialPool: value => this.getCredentialPool(value),
      filterAnthropicHeaders, isGeminiMode, resolveRouteCredentialValue, isXaiBaseUrl, isLongcatBaseUrl, parseCredentialList, resolveXaiAccessToken, hasInvalidCredentialPlaceholder, buildOpenAICompatibilityErrorMessage, isAzureStyleBaseUrl, resolveGeminiCredential, COPILOT_HEADERS, getSessionId, getLocalProviderRetryBaseUrls, buildOllamaChatUrl, logForDebugging, redactUrlForDiagnostics, redactSecretValueForDisplay, headersWithRequestUrl, classifyOpenAINetworkFailure, classifyOpenAIHttpFailure, markOpenAIRequestNonReplayable, fetchRequest: (url, init) => fetchWithHeadersDeadline(url, init, { callerSignal: options?.signal, timeoutMs: apiTimeoutMs }), isResponseHeadersTimeout: error => error instanceof ResponseHeadersTimeoutError, requestBodyContainsImages, formatRetryAfterHint, redactUrlsInMessage, sleepMs, shouldAttemptLocalToollessRetry, refreshCopilotTokenOn401, isCopilotTokenExpiredError, convertOllamaStreamingResponse, convertOllamaNonStreamingResponse, logApiCallStart, logApiCallEnd, stableStringifyJson, APIError, GITHUB_429_MAX_RETRIES, GITHUB_429_BASE_DELAY_SEC, GITHUB_429_MAX_DELAY_SEC, request, params, options, requestProcessEnv, fastPath, shimConfig, runtimeShimContext, body, effectiveTransport, useNativeOllamaChat, buildResponsesBody, serializeBody, isLocal, isGithub, isGithubCopilot, isGithubModels, omitTools,
    })
  }

  private _convertNonStreamingResponse(
    data: NonStreamingOpenAIResponse,
    model: string,
  ) {
    return convertNonStreamingResponseToAnthropicMessage(data, model)
  }

  private _convertGeminiToAnthropicResponse(
    data: Record<string, unknown>,
    model: string,
  ) {
    const content: Array<Record<string, unknown>> = []
    let hasToolUse = false
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined
    const candidate = candidates?.[0]
    const candidateContent = candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined

    if (candidateContent?.parts) {
      for (const part of candidateContent.parts) {
        const text = part.text as string | undefined
        if (text) {
          content.push({ type: 'text', text })
        }
        const fc = part.functionCall as { name?: string; args?: unknown } | undefined
        if (fc?.name) {
          hasToolUse = true
          content.push({
            type: 'tool_use',
            id: `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
            name: fc.name,
            input: fc.args ?? {},
          })
        }
      }
    }

    const stopReason =
      hasToolUse
        ? 'tool_use'
        : candidate?.finishReason === 'MAX_TOKENS'
          ? 'max_tokens'
          : 'end_turn'

    const usageMetadata = data.usageMetadata as Record<string, number> | undefined
    const usage = buildAnthropicUsageFromRawUsage({
      input_tokens: usageMetadata?.promptTokenCount ?? 0,
      output_tokens: (usageMetadata?.candidatesTokenCount ?? 0) + (usageMetadata?.thoughtsTokenCount ?? 0),
    } as unknown as Record<string, unknown>)

    return {
      id: makeMessageId(),
      type: 'message',
      role: 'assistant',
      content,
      model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage,
    }
  }
}

class OpenAIShimBeta {
  messages: OpenAIShimMessages
  reasoningEffort?: OpenAIShimEffortLevel

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: OpenAIShimEffortLevel, providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.messages = new OpenAIShimMessages(defaultHeaders, reasoningEffort, providerOverride)
    this.reasoningEffort = reasoningEffort
  }
}

export function createOpenAIShimClient(options: {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
  reasoningEffort?: OpenAIShimEffortLevel
  providerOverride?: { model: string; baseURL: string; apiKey: string }
}): unknown {
  hydrateGeminiAccessTokenFromSecureStorage()
  hydrateGithubModelsTokenFromSecureStorage()
  hydrateOpenAIShimCompatibilityEnv()

  const beta = new OpenAIShimBeta({
    ...(options.defaultHeaders ?? {}),
  }, options.reasoningEffort, options.providerOverride)

  return {
    beta,
    messages: beta.messages,
  }
}

// Test-only surface (same pattern as WebSearchTool's __test export).
export const __test = {
  convertMessages,
  getApiTimeoutMs,
  getChatMessagesForTransport,
  getCompressedMessagesForTransport,
  requestBodyContainsImages,
  getStreamIdleTimeoutMs,
  readWithIdleTimeout,
  StreamIdleTimeoutError,
}

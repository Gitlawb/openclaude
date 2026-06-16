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
import { isBareMode, isEnvTruthy } from '../../utils/envUtils.js'
import { resolveGeminiCredential } from '../../utils/geminiAuth.js'
import { hydrateGeminiAccessTokenFromSecureStorage } from '../../utils/geminiCredentials.js'
import { hydrateGithubModelsTokenFromSecureStorage } from '../../utils/githubModelsCredentials.js'
import { resolveXaiAccessToken } from '../../utils/xaiCredentials.js'
import { resolveOpenAIShimRuntimeContext } from '../../integrations/runtimeMetadata.js'
import {
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
import { buildAnthropicUsageFromRawUsage } from './cacheMetrics.js'
import { compressToolHistory } from './compressToolHistory.js'
import { fetchWithProxyRetry } from './fetchWithProxyRetry.js'
import {
  getLocalFastPathConfig,
  getLocalProviderRetryBaseUrls,
  getGithubEndpointType,
  isLikelyOllamaEndpoint,
  isLocalProviderUrl,
  resolveRuntimeCodexCredentials,
  resolveProviderRequest,
  shouldAttemptLocalToollessRetry,
  type LocalFastPathConfig,
} from './providerConfig.js'
import {
  buildOpenAICompatibilityErrorMessage,
  classifyOpenAIHttpFailure,
  classifyOpenAINetworkFailure,
} from './openaiErrorClassification.js'
import { sanitizeSchemaForOpenAICompat } from '../../utils/schemaSanitizer.js'
import { redactSecretValueForDisplay, type SecretValueSource } from '../../utils/providerProfile.js'
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

const GITHUB_429_MAX_RETRIES = 3
const GITHUB_429_BASE_DELAY_SEC = 1
const GITHUB_429_MAX_DELAY_SEC = 32
const GEMINI_API_HOST = 'generativelanguage.googleapis.com'
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

function hasGeminiApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    return new URL(baseUrl).hostname.toLowerCase() === GEMINI_API_HOST
  } catch {
    return false
  }
}

function isGeminiModelName(model: string | undefined): boolean {
  const normalized = model?.trim().toLowerCase()
  return (
    normalized?.startsWith('google/gemini-') === true ||
    normalized?.startsWith('gemini-') === true
  )
}

function shouldPreserveGeminiThoughtSignature(
  model: string | undefined,
  baseUrl?: string,
): boolean {
  return isGeminiMode() || hasGeminiApiHost(baseUrl) || isGeminiModelName(model)
}

function geminiThoughtSignatureFromExtraContent(
  extraContent: unknown,
): string | undefined {
  if (!extraContent || typeof extraContent !== 'object') return undefined
  const google = (extraContent as Record<string, unknown>).google
  if (!google || typeof google !== 'object') return undefined
  const signature = (google as Record<string, unknown>).thought_signature
  return typeof signature === 'string' && signature.length > 0 ? signature : undefined
}

function mergeGeminiThoughtSignature(
  extraContent: Record<string, unknown> | undefined,
  signature: string | undefined,
): Record<string, unknown> | undefined {
  if (!signature) return extraContent
  const existingGoogle =
    extraContent?.google && typeof extraContent.google === 'object'
      ? extraContent.google as Record<string, unknown>
      : {}
  return {
    ...extraContent,
    google: {
      ...existingGoogle,
      thought_signature: signature,
    },
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
    return redactSecretValueForDisplay(serialized, process.env as SecretValueSource) ?? serialized
  } catch {
    return redactSecretValueForDisplay(url, process.env as SecretValueSource) ?? url
  }
}

function redactUrlsInMessage(message: string): string {
  return message.replace(/https?:\/\/\S+/g, match => redactUrlForDiagnostics(match))
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

function convertSystemPrompt(
  system: unknown,
): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((block: { type?: string; text?: string }) =>
        block.type === 'text' ? block.text ?? '' : '',
      )
      // Drop the Anthropic billing/attribution block — it's only meaningful to
      // Anthropic's `_parse_cc_header` and is dead weight (plus a churning
      // per-build fingerprint that busts prefix KV cache) for OpenAI-compat
      // providers like local Ollama / llama.cpp / Codex pass-throughs.
      .filter(text => !text.startsWith('x-anthropic-billing-header'))
      .join('\n\n')
  }
  return String(system)
}

function ensureTextPartForImageContent(
  parts: OpenAIContentPart[],
): OpenAIContentPart[] {
  const hasImage = parts.some(part => part.type === 'image_url')
  if (!hasImage) {
    return parts
  }

  const hasText = parts.some(
    part => part.type === 'text' && (part.text ?? '').trim().length > 0,
  )
  if (hasText) {
    return parts
  }

  return [{ type: 'text', text: 'Image attached.' }, ...parts]
}

function joinTextContentParts(parts: OpenAIContentPart[]): string {
  return parts.map(part => part.type === 'text' ? part.text : '').join('')
}

function convertToolResultContent(
  content: unknown,
  isError?: boolean,
): string | OpenAIContentPart[] {
  if (typeof content === 'string') {
    return isError ? `Error: ${content}` : content
  }
  if (!Array.isArray(content)) {
    const text = JSON.stringify(content ?? '')
    return isError ? `Error: ${text}` : text
  }

  const parts: OpenAIContentPart[] = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
      continue
    }

    // ToolSearch results are tool_reference blocks with no text payload —
    // render them so the model learns which deferred tools were loaded
    // (their schemas arrive in the next request's tools array).
    if (block?.type === 'tool_reference' && typeof block.tool_name === 'string') {
      parts.push({
        type: 'text',
        text: `Tool "${block.tool_name}" is now loaded and available to call.`,
      })
      continue
    }

    if (block?.type === 'image') {
      const source = block.source
      if (source?.type === 'url' && source.url) {
        parts.push({ type: 'image_url', image_url: { url: source.url } })
      } else if (source?.type === 'base64' && source.media_type && source.data) {
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
  const allText = parts.every(p => p.type === 'text')
  if (allText) {
    const text = parts.map(p => p.text ?? '').join('\n\n')
    return isError ? `Error: ${text}` : text
  }

  if (isError && parts[0]?.type === 'text') {
    parts[0] = { ...parts[0], text: `Error: ${parts[0].text ?? ''}` }
  } else if (isError) {
    parts.unshift({ type: 'text', text: 'Error:' })
  }

  // Defense in depth (issue #1421): some OpenAI-compatible providers (e.g.
  // Xiaomi Mimo) reject `role: "tool"` messages whose `content` is image-only
  // with a 400 "text is not set". Prepend a placeholder text part so the
  // payload always carries a text component alongside any images, mirroring
  // the existing behavior for user-role messages.
  return ensureTextPartForImageContent(parts)
}

function convertContentBlocks(
  content: unknown,
): string | OpenAIContentPart[] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts: OpenAIContentPart[] = []
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
  const allText = parts.every(p => p.type === 'text')
  if (allText) {
    return parts.map(p => p.text ?? '').join('\n\n')
  }

  return ensureTextPartForImageContent(parts)
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
    const geminiApiKey =
      processEnv.GEMINI_API_KEY ?? processEnv.GOOGLE_API_KEY
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
    preserveGeminiThoughtSignature?: boolean
  },
): OpenAIMessage[] {
  const preserveReasoningContent = options?.preserveReasoningContent === true
  const reasoningContentFallback = options?.reasoningContentFallback
  const preserveGeminiThoughtSignature = options?.preserveGeminiThoughtSignature === true
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
          (b: { type?: string }) =>
            b.type === 'thinking' ||
            b.type === 'redacted_thinking',
        )
        const textContent = content.filter(
          (b: { type?: string }) =>
            b.type !== 'tool_use' &&
            b.type !== 'thinking' &&
            b.type !== 'redacted_thinking',
        )

        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: (() => {
            const c = convertContentBlocks(textContent)
            return typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? joinTextContentParts(c)
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
          // `thinking` blocks carry their content in `.thinking`; `redacted_thinking`
          // blocks carry it in `.data` (see token estimation and message-size
          // accounting). Read the right field per type so a real redacted block
          // with non-empty content is not silently dropped to "".
          const block = thinkingBlock as
            | { type?: string; thinking?: string; data?: string }
            | undefined
          const thinkingText =
            block?.type === 'redacted_thinking'
              ? block?.data
              : block?.thinking
          if (typeof thinkingText === 'string' && thinkingText.trim().length > 0) {
            assistantMsg.reasoning_content = thinkingText
          } else if (
            toolUses.length > 0 &&
            reasoningContentFallback === ''
          ) {
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
                const id = tu.id ?? `call_${crypto.randomUUID().replace(/-/g, '')}`

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

                // Gemini OpenAI-compatible endpoints require Google's
                // thought_signature to be replayed with prior function-call
                // parts. Preserve only real signatures received from the
                // provider; synthetic placeholders are rejected by GMI.
                if (preserveGeminiThoughtSignature) {
                  const signature =
                    tu.signature ??
                    geminiThoughtSignatureFromExtraContent(tu.extra_content) ??
                    (thinkingBlock as { signature?: string } | undefined)?.signature

                  toolCall.extra_content = mergeGeminiThoughtSignature(
                    toolCall.extra_content,
                    signature,
                  )
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
                ? joinTextContentParts(c)
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
    // If a 'tool' result is followed by a 'user' message, inject a neutral
    // assistant boundary to satisfy the strict role sequence without implying
    // that the user interrupted or cancelled anything:
    // ... -> assistant (calls) -> tool (results) -> assistant (semantic) -> user (next)
    if (prev && prev.role === 'tool' && msg.role === 'user') {
      coalesced.push({
        role: 'assistant',
        content: '[Tool results received]',
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
          c: string | OpenAIContentPart[] | undefined,
        ): OpenAIContentPart[] => {
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
    const properties = record.properties as Record<string, Record<string, unknown>>
    const existingRequired = Array.isArray(record.required) ? record.required as string[] : []

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
      record.required = existingRequired.filter(k => k in normalizedProps)
      // additionalProperties: false is still required by strict-mode providers.
      record.additionalProperties = false
    } else {
      // For Gemini: keep only existing required keys that are present in properties
      record.required = existingRequired.filter(k => k in normalizedProps)
    }
  }

  // Recurse into array items
  if ('items' in record) {
    if (Array.isArray(record.items)) {
      record.items = (record.items as unknown[]).map(
        item => normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    } else {
      record.items = normalizeSchemaForOpenAI(record.items as Record<string, unknown>, strict)
    }
  }

  // Recurse into combinators
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (key in record && Array.isArray(record[key])) {
      record[key] = (record[key] as unknown[]).map(
        item => normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    }
  }

  return record
}

function convertTools(
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>,
  options: { skipStrict?: boolean } = {},
): OpenAITool[] {
  const isGemini = isGeminiMode()
  const strict =
    !isGemini &&
    !isEnvTruthy(process.env.OPENCLAUDE_DISABLE_STRICT_TOOLS) &&
    !options.skipStrict

  return tools
    .filter(t => t.name !== 'ToolSearchTool') // Not relevant for OpenAI
    .map(t => {
      const schema = { ...(t.input_schema ?? { type: 'object', properties: {} }) } as Record<string, unknown>

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

const JSON_REPAIR_SUFFIXES = [
  '}', '"}', ']}', '"]}', '}}', '"}}', ']}}', '"]}}', '"]}]}', '}]}'
]

const RAW_TOOL_CALLS_REQUESTED_PREFIX = 'Tool calls requested:'

type ParsedRawToolCall = {
  id: string
  name: string
  argumentsJson: string
}

function couldBeRawToolCallsRequestedPrefix(text: string): boolean {
  const trimmedStart = text.trimStart()
  return (
    RAW_TOOL_CALLS_REQUESTED_PREFIX.startsWith(trimmedStart) ||
    trimmedStart.startsWith(RAW_TOOL_CALLS_REQUESTED_PREFIX)
  )
}

function parseRawToolCallsRequestedText(text: string): ParsedRawToolCall[] | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(RAW_TOOL_CALLS_REQUESTED_PREFIX)) {
    return null
  }

  const lines = trimmed
    .slice(RAW_TOOL_CALLS_REQUESTED_PREFIX.length)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  const toolCalls: ParsedRawToolCall[] = []
  for (const line of lines) {
    const match = line.match(
      /^-\s*([A-Za-z_][A-Za-z0-9_.-]*)\(([\s\S]*)\)\s*\[id:\s*([^\]\s]+)\]\s*$/,
    )
    if (!match) return null

    const [, name, rawArguments, id] = match
    if (!name || !id || rawArguments === undefined) return null

    const normalizedArguments = normalizeToolArguments(name, rawArguments)
    toolCalls.push({
      id,
      name,
      argumentsJson: JSON.stringify(normalizedArguments ?? {}),
    })
  }

  return toolCalls.length > 0 ? toolCalls : null
}

function repairPossiblyTruncatedObjectJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? raw
      : null
  } catch {
    for (const combo of JSON_REPAIR_SUFFIXES) {
      try {
        const repaired = raw + combo
        const parsed = JSON.parse(repaired)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return repaired
        }
      } catch {}
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Ollama text-based tool call parser (fix for #1053)
//
// When Ollama models cannot emit structured tool_calls via the OpenAI-compat
// API, they fall back to printing the call as a JSON block in the response
// text. This parser extracts those calls so the agent loop can execute them.
//
// Supported formats emitted by qwen2.5-coder, llama3.x, phi-4, gemma:
//   ```json\n{"name":"X","arguments":{...}}\n```
//   {"name":"X","arguments":{...}}
//   {"type":"function","function":{"name":"X","arguments":{...}}}
// ---------------------------------------------------------------------------

// Fenced code block arm: non-greedy is safe because ``` acts as terminator.
const FENCED_TOOL_CALL_RE = /```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/g
// Bare JSON arm: marks candidate start positions only; balanced extraction follows.
// Allow optional whitespace (including newlines) before the property key so
// pretty-printed objects like "{\n  \"name\":" are detected.
const BARE_TOOL_CALL_START_RE = /\{\s*"(?:name|type)"\s*:/g

interface ParsedTextToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

// Module-level counter ensures unique IDs across calls within a session.
let _textToolCallCounter = 0

// Walks forward from `start` (which must be `{`) tracking string/escape/brace
// state and returns the substring up to and including the matching `}`, or
// null if the braces are never balanced (truncated input).
function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]!
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseAndAdd(
  raw: string,
  results: ParsedTextToolCall[],
  seen: Set<string>,
): boolean {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw)
  } catch {
    return false
  }

  let name: string | undefined
  let args: Record<string, unknown> = {}

  if (typeof obj['name'] === 'string') {
    // {"name": "X", "arguments": {...}}
    name = obj['name'] as string
    args = (obj['arguments'] as Record<string, unknown>) ?? {}
  } else if (
    obj['type'] === 'function' &&
    typeof (obj['function'] as any)?.name === 'string'
  ) {
    // {"type":"function","function":{"name":"X","arguments":{...}}}
    const fn = obj['function'] as { name: string; arguments?: unknown }
    name = fn.name
    const rawArgs = fn.arguments
    args =
      typeof rawArgs === 'string'
        ? (() => {
            try {
              return JSON.parse(rawArgs)
            } catch {
              return {}
            }
          })()
        : (rawArgs as Record<string, unknown>) ?? {}
  }

  if (!name) return false

  const dedupKey = `${name}:${JSON.stringify(args)}`
  if (seen.has(dedupKey)) return false
  seen.add(dedupKey)

  results.push({ id: `ollama_tc_${++_textToolCallCounter}`, name, arguments: args })
  return true
}

/** Removes character ranges from `text`, returning the remaining content. */
function stripRanges(text: string, ranges: Array<[number, number]>): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  let result = ''
  let pos = 0
  for (const [s, e] of sorted) {
    result += text.slice(pos, s)
    pos = e
  }
  return result + text.slice(pos)
}

/** Exported for unit testing only. */
export function parseTextToolCalls(text: string): {
  calls: ParsedTextToolCall[]
  toolCallRanges: Array<[number, number]>
} {
  const results: ParsedTextToolCall[] = []
  const seen = new Set<string>()
  const fencedRanges: Array<[number, number]> = []
  // acceptedRanges tracks only ranges where parseAndAdd confirmed a valid tool
  // call was emitted — these are what callers strip from text.  fencedRanges
  // (all fenced blocks regardless of acceptance) is kept separately so Pass 2
  // can skip over them and avoid double-processing.
  const acceptedRanges: Array<[number, number]> = []

  // Pass 1: fenced code blocks — regex is safe, ``` bounds the non-greedy match.
  // Context guard: same heuristic as Pass 2 — if non-whitespace, non-`{` text
  // immediately follows the closing fence, the model is explaining a format rather
  // than calling a tool; skip to avoid false positives on fenced examples.
  for (const match of text.matchAll(FENCED_TOOL_CALL_RE)) {
    const raw = (match[1] ?? '').trim()
    const after = text.slice(match.index! + match[0].length).trimStart()
    if (after.length > 0 && !after.startsWith('{')) continue
    const range: [number, number] = [match.index!, match.index! + match[0].length]
    fencedRanges.push(range)
    if (raw && parseAndAdd(raw, results, seen)) {
      acceptedRanges.push(range)
    }
  }

  // Pass 2: bare JSON — use the brace scanner so nested objects are captured fully.
  // processedRanges grows as we extract; inner objects nested inside an outer
  // tool call are skipped because their start falls inside an already-extracted range.
  const processedRanges: Array<[number, number]> = [...fencedRanges]
  for (const match of text.matchAll(BARE_TOOL_CALL_START_RE)) {
    const start = match.index!
    if (processedRanges.some(([s, e]) => start >= s && start < e)) continue
    const raw = extractBalancedJson(text, start)
    if (raw) {
      // Context guard: if non-whitespace, non-`{` text immediately follows the JSON
      // the model is likely explaining, not calling — skip to avoid false positives.
      const after = text.slice(start + raw.length).trimStart()
      if (after.length > 0 && !after.startsWith('{')) continue
      const range: [number, number] = [start, start + raw.length]
      processedRanges.push(range)
      if (parseAndAdd(raw, results, seen)) {
        acceptedRanges.push(range)
      }
    }
  }

  return { calls: results, toolCallRanges: acceptedRanges }
}

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
  const readerOrNull = response.body?.getReader()
  if (!readerOrNull) throw new Error('Response body is not readable')
  const reader: ReadableStreamDefaultReader<Uint8Array> = readerOrNull
  const decoder = new TextDecoder()
  let buffer = ''

  // Read helper that properly cleans up abort listeners (mirrors codexShim.ts pattern).
  type ReadResult = Awaited<ReturnType<typeof reader.read>>
  function readWithAbort(): Promise<ReadResult> {
    if (!signal) return reader.read()
    return new Promise<ReadResult>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      reader.read().then(
        result => { signal.removeEventListener('abort', onAbort); resolve(result) },
        err => { signal.removeEventListener('abort', onAbort); reject(err) },
      )
    })
  }

  try {
    while (true) {
      const { done, value } = await readWithAbort()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean)
        if (lines.length === 0) continue

        const dataLines = lines.filter(l => l.startsWith('data: '))
        if (dataLines.length === 0) continue

        const rawData = dataLines.map(l => l.slice(6)).join('\n')
        if (rawData === '[DONE]') return

        try {
          const parsed = JSON.parse(rawData) as AnthropicStreamEvent
          if (parsed && typeof parsed === 'object' && 'type' in parsed) {
            yield parsed
          }
        } catch {
          // skip malformed frames
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
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
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader()
  if (!reader) throw new Error('Response body is not readable')
  const decoder = new TextDecoder()
  let buffer = ''
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  let hasEmittedStart = false
  let hasEmittedTextStart = false
  let hasEmittedCurrentTool = false
  let usage: Partial<AnthropicUsage> | undefined
  let finishReason: string | undefined

  function readWithAbort(): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (!signal) return reader!.read() as Promise<ReadableStreamReadResult<Uint8Array>>
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      reader!.read().then(
        result => { signal.removeEventListener('abort', onAbort); resolve(result as ReadableStreamReadResult<Uint8Array>) },
        err => { signal.removeEventListener('abort', onAbort); reject(err) },
      )
    })
  }

  function mapFinishReason(reason: string | undefined, hasToolUse: boolean): string {
    if (hasToolUse) return 'tool_use'
    if (reason === 'MAX_TOKENS') return 'max_tokens'
    return 'end_turn'
  }

  try {
    while (true) {
      const { done, value } = await readWithAbort()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean)
        const dataLines = lines.filter(l => l.startsWith('data: '))
        if (dataLines.length === 0) continue

        const rawData = dataLines.map(l => l.slice(6)).join('\n')
        if (rawData === '[DONE]') {
          if (hasEmittedTextStart || hasEmittedCurrentTool) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
          }
          yield {
            type: 'message_delta',
            delta: { stop_reason: mapFinishReason(finishReason, hasEmittedCurrentTool) },
            usage: usage ?? {},
          }
          yield { type: 'message_stop' }
          return
        }

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(rawData) as Record<string, unknown>
        } catch {
          continue
        }

        if (!hasEmittedStart) {
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
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          }
          hasEmittedStart = true
        }

        if (parsed.usageMetadata && typeof parsed.usageMetadata === 'object') {
          const um = parsed.usageMetadata as Record<string, number>
          usage = buildAnthropicUsageFromRawUsage({
            input_tokens: um.promptTokenCount ?? 0,
            output_tokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
          })
        }

        const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined
        if (!candidates || candidates.length === 0) continue
        const candidate = candidates[0]

        if (typeof candidate.finishReason === 'string') {
          finishReason = candidate.finishReason
        }

        const content = candidate.content as { role?: string; parts?: Array<Record<string, unknown>> } | undefined
        if (!content || !content.parts) continue

        for (const part of content.parts) {
          const text = part.text as string | undefined
          const fc = part.functionCall as { name?: string; args?: unknown } | undefined

          if (text) {
            if (hasEmittedCurrentTool) {
              yield { type: 'content_block_stop', index: contentBlockIndex }
              contentBlockIndex++
              hasEmittedCurrentTool = false
            }
            if (!hasEmittedTextStart) {
              yield {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              }
              hasEmittedTextStart = true
            }
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text },
            }
          } else if (fc?.name) {
            if (hasEmittedTextStart) {
              yield { type: 'content_block_stop', index: contentBlockIndex }
              contentBlockIndex++
              hasEmittedTextStart = false
            }
            const toolId = `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: toolId,
                name: fc.name,
                input: {},
              },
            }
            hasEmittedCurrentTool = true
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: typeof fc.args === 'string' ? fc.args : JSON.stringify(fc.args ?? {}),
              },
            }
          }
        }
      }
    }

    if (hasEmittedTextStart || hasEmittedCurrentTool) {
      yield { type: 'content_block_stop', index: contentBlockIndex }
    }
    yield {
      type: 'message_delta',
      delta: { stop_reason: mapFinishReason(finishReason, hasEmittedCurrentTool) },
      usage: usage ?? {},
    }
    yield { type: 'message_stop' }
  } finally {
    reader.releaseLock()
  }
}

async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
  isOllama = false,
): AsyncGenerator<AnthropicStreamEvent> {
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  const activeToolCalls = new Map<
    number,
    {
      id: string
      name: string
      index: number
      jsonBuffer: string
      normalizeAtStop: boolean
    }
  >()
  let hasEmittedContentStart = false
  let hasEmittedThinkingStart = false
  let hasClosedThinking = false
  const thinkFilter = createThinkTagFilter()
  let lastStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | null = null
  let hasEmittedFinalUsage = false
  let hasProcessedFinishReason = false
  // Accumulated text for Ollama text-based tool call fallback parsing (#1053)
  let accumulatedText = ''
  // Use the resolved value threaded from the call site (resolveProviderRequest)
  // rather than re-reading env vars inside the generator.
  const isOllamaStream = isOllama
  // Buffer Ollama text deltas so raw tool-call JSON is never emitted as text_delta
  // before extraction at finish_reason=stop (P2 fix for #1053).
  let ollamaTextBuffer = ''
  const streamState = createStreamState()
  let bufferedRawToolCallsText: string | null = null

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
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }

  const readerOrNull = response.body?.getReader()
  if (!readerOrNull) throw new Error('Response body is not readable')
  const reader: ReadableStreamDefaultReader<Uint8Array> = readerOrNull

  const decoder = new TextDecoder()
  let buffer = ''
  const STREAM_IDLE_TIMEOUT_MS = 120_000 // 2 minutes without data = connection likely dead
  let lastDataTime = Date.now()

  /**
   * Read from the stream with an idle timeout. If no data arrives within
   * STREAM_IDLE_TIMEOUT_MS, assume the connection is dead and throw so
   * withRetry can reconnect. This prevents indefinite hangs on stale
   * SSE connections from OpenAI/Gemini during long-running sessions.
   * Respects the caller's AbortSignal — clears the idle timer on abort
   * so the rejection reason is AbortError, not a spurious idle timeout.
   */
  type ReadResult = Awaited<ReturnType<typeof reader.read>>
  async function readWithTimeout(): Promise<ReadResult> {
    return new Promise<ReadResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const elapsed = Math.round((Date.now() - lastDataTime) / 1000)
        reject(new Error(
          `OpenAI/Gemini SSE stream idle for ${elapsed}s (limit: ${STREAM_IDLE_TIMEOUT_MS / 1000}s). Connection likely dropped.`,
        ))
      }, STREAM_IDLE_TIMEOUT_MS)

      // If the caller aborts, clear the timer so the AbortError surfaces
      // cleanly instead of being masked by a spurious idle timeout.
      let abortCleanup: (() => void) | undefined
      if (signal) {
        abortCleanup = () => {
          clearTimeout(timeoutId)
        }
        signal.addEventListener('abort', abortCleanup, { once: true })
      }

      reader.read().then(
        result => {
          clearTimeout(timeoutId)
          if (signal && abortCleanup) signal.removeEventListener('abort', abortCleanup)
          if (result.value) lastDataTime = Date.now()
          resolve(result)
        },
        err => {
          clearTimeout(timeoutId)
          if (signal && abortCleanup) signal.removeEventListener('abort', abortCleanup)
          reject(err)
        },
      )
    })
  }

  const closeActiveContentBlock = async function* () {
    if (!hasEmittedContentStart) return

    const tail = thinkFilter.flush()
    if (tail) {
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

  const emitTextDelta = async function* (text: string) {
    if (!text) return
    if (!hasEmittedContentStart) {
      yield {
        type: 'content_block_start',
        index: contentBlockIndex,
        content_block: { type: 'text', text: '' },
      }
      hasEmittedContentStart = true
    }

    const visible = thinkFilter.feed(text)
    if (visible) {
      yield {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: { type: 'text_delta', text: visible },
      }
    }
    processStreamChunk(streamState, text)
  }

  const emitParsedRawToolCalls = async function* (
    toolCalls: ParsedRawToolCall[],
  ) {
    if (hasEmittedThinkingStart && !hasClosedThinking) {
      yield { type: 'content_block_stop', index: contentBlockIndex }
      contentBlockIndex++
      hasClosedThinking = true
    }
    if (hasEmittedContentStart) {
      yield* closeActiveContentBlock()
    }

    for (const toolCall of toolCalls) {
      const toolBlockIndex = contentBlockIndex
      yield {
        type: 'content_block_start',
        index: toolBlockIndex,
        content_block: {
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: {},
        },
      }
      contentBlockIndex++
      yield {
        type: 'content_block_delta',
        index: toolBlockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: toolCall.argumentsJson,
        },
      }
      yield { type: 'content_block_stop', index: toolBlockIndex }
      processStreamChunk(streamState, toolCall.argumentsJson)
    }
  }

  try {
    while (true) {
      const { done, value } = await readWithTimeout()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      let chunk: OpenAIStreamChunk
      try {
        chunk = JSON.parse(trimmed.slice(6))
      } catch {
        continue
      }

      // In-stream error event. Used by OpenAI when a stream fails after
      // headers have been sent, and by intermediaries (e.g. gateways) that
      // want to signal a structured failure without dropping the TCP
      // connection. Surface it as an APIError so callers see a clean
      // message instead of "stream ended without [DONE]".
      const inStreamError = (chunk as unknown as { error?: { message?: string; type?: string; code?: string } }).error
      if (inStreamError && typeof inStreamError === 'object') {
        const message =
          typeof inStreamError.message === 'string'
            ? inStreamError.message
            : 'Provider returned an in-stream error'
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
        const delta = choice.delta

        // Reasoning models (e.g. GLM-5, DeepSeek) may stream chain-of-thought
        // in `reasoning_content` before the actual reply appears in `content`.
        // Emit reasoning as a thinking block and content as a text block.
        if (delta.reasoning_content != null && delta.reasoning_content !== '') {
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
            delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
          }
        }

        // Text content — use != null to distinguish absent field from empty string,
        // some providers send "" as first delta to signal streaming start
        if (delta.content != null && delta.content !== '') {
          // Close thinking block if transitioning from reasoning to content
          if (hasEmittedThinkingStart && !hasClosedThinking) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasClosedThinking = true
          }

          accumulatedText += delta.content
          if (isOllamaStream) {
            const visible = thinkFilter.feed(delta.content)
            if (visible) {
              ollamaTextBuffer += visible
            }
          } else if (
            !hasEmittedContentStart &&
            bufferedRawToolCallsText === null &&
            couldBeRawToolCallsRequestedPrefix(delta.content)
          ) {
            bufferedRawToolCallsText = delta.content
            processStreamChunk(streamState, delta.content)
          } else if (bufferedRawToolCallsText !== null) {
            bufferedRawToolCallsText += delta.content
            processStreamChunk(streamState, delta.content)
            if (!couldBeRawToolCallsRequestedPrefix(bufferedRawToolCallsText)) {
              yield* emitTextDelta(bufferedRawToolCallsText)
              bufferedRawToolCallsText = null
            }
          } else {
            yield* emitTextDelta(delta.content)
          }
        }

        // Tool calls
        if (delta.tool_calls) {
          if (bufferedRawToolCallsText !== null) {
            const parsedBufferedToolCalls = parseRawToolCallsRequestedText(
              bufferedRawToolCallsText,
            )
            if (
              !parsedBufferedToolCalls &&
              !couldBeRawToolCallsRequestedPrefix(bufferedRawToolCallsText)
            ) {
              yield* emitTextDelta(bufferedRawToolCallsText)
            }
            bufferedRawToolCallsText = null
          }
          for (const tc of delta.tool_calls) {
            if (tc.id && tc.function?.name) {
              // New tool call starting — close any open thinking block first
              if (hasEmittedThinkingStart && !hasClosedThinking) {
                yield { type: 'content_block_stop', index: contentBlockIndex }
                contentBlockIndex++
                hasClosedThinking = true
              }
              // Flush buffered Ollama text before processing the tool call.
              // Must run before hasEmittedContentStart check because for Ollama
              // streams the text block may not have been opened yet (we buffer
              // instead of emitting during the streaming phase).
              if (isOllamaStream && ollamaTextBuffer) {
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
                  delta: { type: 'text_delta', text: ollamaTextBuffer },
                }
                ollamaTextBuffer = ''
              }
              if (hasEmittedContentStart) {
                yield* closeActiveContentBlock()
              }

              const toolBlockIndex = contentBlockIndex
              const initialArguments = tc.function.arguments ?? ''
              const normalizeAtStop = hasToolFieldMapping(tc.function.name)
              const toolExtraContent = tc.extra_content ?? delta.extra_content
              const toolSignature =
                geminiThoughtSignatureFromExtraContent(tc.extra_content) ??
                geminiThoughtSignatureFromExtraContent(delta.extra_content)
              const mergedToolExtraContent = mergeGeminiThoughtSignature(
                toolExtraContent,
                toolSignature,
              )
              processStreamChunk(streamState, tc.function.arguments ?? '')
              activeToolCalls.set(tc.index, {
                id: tc.id,
                name: tc.function.name,
                index: toolBlockIndex,
                jsonBuffer: initialArguments,
                normalizeAtStop,
              })

              yield {
                type: 'content_block_start',
                index: toolBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: {},
                  ...(mergedToolExtraContent ? { extra_content: mergedToolExtraContent } : {}),
                  ...(toolSignature ? { signature: toolSignature } : {}),
                },
              }
              contentBlockIndex++

              // Emit any initial arguments
              if (tc.function.arguments && !normalizeAtStop) {
                yield {
                  type: 'content_block_delta',
                  index: toolBlockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            } else if (tc.function?.arguments) {
              // Continuation of existing tool call
              const active = activeToolCalls.get(tc.index)
              if (active) {
                if (tc.function.arguments) {
                  active.jsonBuffer += tc.function.arguments
                }

                if (active.normalizeAtStop) {
                  continue
                }

                yield {
                  type: 'content_block_delta',
                  index: active.index,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            }
          }
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
          // Ollama text-based tool call fallback (#1053):
          // Must run before closeActiveContentBlock so the text buffer can be flushed
          // with tool-call JSON stripped (P2). Ollama models emit tool calls as raw
          // JSON text; scan accumulated text on any terminal finish reason with no
          // API tool calls. finish_reason is mutated to 'tool_calls' only for 'stop'
          // so the JSON fallback remains scoped to normal completions.
          const OLLAMA_TERMINAL_REASONS = new Set(['stop', 'length', 'content_filter', 'safety'])
          const isTerminalOllamaFinish =
            OLLAMA_TERMINAL_REASONS.has(choice.finish_reason ?? '') &&
            activeToolCalls.size === 0 &&
            isOllamaStream
          const originalFinishReason = choice.finish_reason
          let ollamaClosedContentBlock = false
          if (isTerminalOllamaFinish) {
            const { calls: textToolCalls, toolCallRanges } = parseTextToolCalls(accumulatedText)
            if (textToolCalls.length > 0) {
              ollamaClosedContentBlock = true
              // Compute visible prose (tool-call JSON stripped, think-tags removed).
              // Use accumulatedText (raw) as source because toolCallRanges are relative to it.
              const stripped = stripRanges(accumulatedText, toolCallRanges).trim()
              const strippedVisible = stripThinkTags(stripped).trim()
              if (hasEmittedContentStart) {
                // Text block was already open — emit stripped prose then close it.
                if (strippedVisible) {
                  yield {
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: { type: 'text_delta', text: strippedVisible },
                  }
                }
                yield* closeActiveContentBlock()
              } else if (strippedVisible) {
                // Text was buffered (Ollama path, hasEmittedContentStart === false).
                // Open a text block, emit the visible prose before the tool call, close it.
                yield {
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: '' },
                }
                hasEmittedContentStart = true
                yield {
                  type: 'content_block_delta',
                  index: contentBlockIndex,
                  delta: { type: 'text_delta', text: strippedVisible },
                }
                yield* closeActiveContentBlock()
              }
              for (const tc of textToolCalls) {
                const toolBlockIndex = contentBlockIndex
                yield {
                  type: 'content_block_start',
                  index: toolBlockIndex,
                  content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} },
                }
                contentBlockIndex++
                yield {
                  type: 'content_block_delta',
                  index: toolBlockIndex,
                  delta: { type: 'input_json_delta', partial_json: JSON.stringify(tc.arguments) },
                }
                yield { type: 'content_block_stop', index: toolBlockIndex }
              }
              // Only remap finish_reason to 'tool_calls' for the normal stop case;
              // non-stop terminal reasons keep their original reason.
              if (originalFinishReason === 'stop') {
                choice.finish_reason = 'tool_calls'
              }
            } else if (ollamaTextBuffer) {
              // No tool calls — flush the buffered text before the normal close below.
              // Open a text block first if one is not already open (guards the edge case
              // where hasEmittedContentStart is false but the buffer has content).
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
                delta: { type: 'text_delta', text: ollamaTextBuffer },
              }
            }
          }

          // Flush bufferedRawToolCallsText for non-Ollama providers
          const parsedBufferedToolCalls = bufferedRawToolCallsText
            ? parseRawToolCallsRequestedText(bufferedRawToolCallsText)
            : null
          if (parsedBufferedToolCalls) {
            yield* emitParsedRawToolCalls(parsedBufferedToolCalls)
            bufferedRawToolCallsText = null
          } else if (bufferedRawToolCallsText !== null) {
            yield* emitTextDelta(bufferedRawToolCallsText)
            bufferedRawToolCallsText = null
          }

          // Close any open content blocks (skipped when Ollama already closed it above)
          if (hasEmittedContentStart && !ollamaClosedContentBlock) {
            yield* closeActiveContentBlock()
          }
          // Close active tool calls
          for (const [, tc] of activeToolCalls) {
            if (tc.normalizeAtStop) {
              let partialJson: string
              if (choice.finish_reason === 'length') {
                // Truncated by max tokens — preserve raw buffer to avoid
                // turning an incomplete tool call into an executable command
                partialJson = tc.jsonBuffer
              } else {
                const repairedStructuredJson = repairPossiblyTruncatedObjectJson(
                  tc.jsonBuffer,
                )
                if (repairedStructuredJson) {
                  partialJson = repairedStructuredJson
                } else {
                  partialJson = JSON.stringify(
                    normalizeToolArguments(tc.name, tc.jsonBuffer),
                  )
                }
              }

              yield {
                type: 'content_block_delta',
                index: tc.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: partialJson,
                },
              }
              yield { type: 'content_block_stop', index: tc.index }
              continue
            }

            let suffixToAdd = ''
            if (tc.jsonBuffer) {
              try {
                JSON.parse(tc.jsonBuffer)
              } catch {
                const str = tc.jsonBuffer.trimEnd()
                for (const combo of JSON_REPAIR_SUFFIXES) {
                  try {
                    JSON.parse(str + combo)
                    suffixToAdd = combo
                    break
                  } catch {}
                }
              }
            }

            if (suffixToAdd) {
              yield {
                type: 'content_block_delta',
                index: tc.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: suffixToAdd,
                },
              }
            }

            yield { type: 'content_block_stop', index: tc.index }
          }

          const stopReason =
            parsedBufferedToolCalls || choice.finish_reason === 'tool_calls'
              ? 'tool_use'
              : choice.finish_reason === 'length'
                ? 'max_tokens'
                : 'end_turn'
          if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'safety') {
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
              delta: { type: 'text_delta', text: '\n\n[Content blocked by provider safety filter]' },
            }
          } else if (choice.finish_reason === 'length') {
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
              delta: { type: 'text_delta', text: '\n\n[Response truncated — reached length limit or upstream stalled. Ask the model to continue.]' },
            }
          }
          lastStopReason = stopReason

          yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            ...(chunkUsage ? { usage: chunkUsage } : {}),
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
        }
        hasEmittedFinalUsage = true
      }
    }
    }
  } finally {
    reader.releaseLock()
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

  constructor(generator: AsyncGenerator<AnthropicStreamEvent>) {
    this.generator = generator
  }

  async *[Symbol.asyncIterator]() {
    yield* this.generator
  }
}

class OpenAIShimMessages {
  private defaultHeaders: Record<string, string>
  private reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  private providerOverride?: { model: string; baseURL: string; apiKey: string }

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.defaultHeaders = filterAnthropicHeaders(defaultHeaders)
    this.reasoningEffort = reasoningEffort
    this.providerOverride = providerOverride
  }

  create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const self = this

    let httpResponse: Response | undefined

    const promise = (async () => {
      const request = resolveProviderRequest({ model: self.providerOverride?.model ?? params.model, baseUrl: self.providerOverride?.baseURL, reasoningEffortOverride: self.reasoningEffort })
      const response = await self._doRequest(request, params, options)
      httpResponse = response

      if (params.stream) {
        const isResponsesStream = response.url?.includes('/responses')
        const isMessagesStream = response.url?.includes('/messages')
        const isGeminiStream = response.url?.includes('/models/gemini-')
        return new OpenAIShimStream(
          (
            request.transport === 'codex_responses' ||
            request.transport === 'responses' ||
            isResponsesStream
          )
            ? codexStreamToAnthropic(response, request.resolvedModel, options?.signal)
            : isMessagesStream
              ? anthropicSsePassthrough(response, request.resolvedModel, options?.signal)
              : isGeminiStream
                ? geminiSseToAnthropic(response, request.resolvedModel, options?.signal)
                : openaiStreamToAnthropic(response, request.resolvedModel, options?.signal, isLikelyOllamaEndpoint(request.baseUrl)),
        )
      }

      if (request.transport === 'codex_responses') {
        const data = await collectCodexCompletedResponse(response, options?.signal)
        return convertCodexResponseToAnthropicMessage(
          data,
          request.resolvedModel,
        )
      }

      const isResponsesNonStream = response.url?.includes('/responses')
      const isMessagesNonStream = response.url?.includes('/messages')
      const isGeminiNonStream = response.url?.includes('/models/gemini-')
      if (
        request.transport === 'responses' ||
        isResponsesNonStream ||
        (request.transport === 'chat_completions' && isGithubModelsMode())
      ) {
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          const parsed = await response.json() as Record<string, unknown>
          if (
            parsed &&
            typeof parsed === 'object' &&
            ('output' in parsed || 'incomplete_details' in parsed)
          ) {
            return convertCodexResponseToAnthropicMessage(
              parsed,
              request.resolvedModel,
            )
          }
          return self._convertNonStreamingResponse(parsed, request.resolvedModel)
        }
      }

      // Anthropic Messages API response — already in Anthropic format,
      // pass through directly without conversion.
      if (isMessagesNonStream) {
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          return await response.json() as Record<string, unknown>
        }
      }

      // Google AI SDK response — convert to Anthropic format
      if (isGeminiNonStream) {
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          const parsed = await response.json() as Record<string, unknown>
          return self._convertGeminiToAnthropicResponse(parsed, request.resolvedModel)
        }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const data = await response.json()
        return self._convertNonStreamingResponse(data, request.resolvedModel)
      }

      const textBody = await response.text().catch(() => '')
      throw APIError.generate(
        response.status,
        undefined,
        `OpenAI API error ${response.status}: unexpected response content-type: ${response.headers.get('content-type') ?? 'unknown'}`,
        response.headers as unknown as Headers,
      )
    })()

      ; (promise as unknown as Record<string, unknown>).withResponse =
        async () => {
          const data = await promise
          return {
            data,
            response: httpResponse ?? new Response(),
            request_id:
              httpResponse?.headers.get('x-request-id') ?? makeMessageId(),
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
    const isGithubWithCodexTransport = isGithubMode && request.transport === 'codex_responses'

    if (isGithubWithCodexTransport) {
      const apiKey = this.providerOverride?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
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
    const fastPath: LocalFastPathConfig = getLocalFastPathConfig(request.baseUrl)

    const rawMessages = params.messages as Array<{
      role: string
      message?: { role?: string; content?: unknown }
      content?: unknown
    }>
    const compressedMessages = fastPath.skipToolHistoryCompression
      ? rawMessages
      : compressToolHistory(rawMessages, request.resolvedModel)
    const runtimeShimContext = resolveOpenAIShimRuntimeContext({
      processEnv: process.env,
      baseUrl: request.baseUrl,
      model: request.resolvedModel,
      treatAsLocal: isLocalProviderUrl(request.baseUrl),
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
    const openaiMessages = convertMessages(compressedMessages, params.system, {
      preserveReasoningContent: shimConfig.preserveReasoningContent,
      reasoningContentFallback: shimConfig.reasoningContentFallback,
      preserveGeminiThoughtSignature: shouldPreserveGeminiThoughtSignature(
        request.resolvedModel,
        request.baseUrl,
      ),
    })

    const body: Record<string, unknown> = {
      model: request.resolvedModel,
      messages: openaiMessages,
      stream: params.stream ?? false,
      store: false,
    }
    // Emit reasoning_effort for chat_completions when the resolved provider
     // request carries a reasoning effort (set via /effort, model alias default,
     // or `?reasoning=<level>` query on the model string). OpenAI, Codex, and
     // most OpenAI-compatible endpoints read it from this top-level field.
    if (request.reasoning) {
      body.reasoning_effort = request.reasoning.effort
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
    const isGithubCopilot = isGithub && githubEndpointType === 'copilot'
    const isGithubModels = isGithub && (githubEndpointType === 'models' || githubEndpointType === 'custom')
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
      const requestedThinkingType = (params.thinking as { type?: string } | undefined)?.type
      const deepSeekThinkingType =
        requestedThinkingType === 'disabled'
          ? 'disabled'
          : requestedThinkingType === 'enabled' || requestedThinkingType === 'adaptive'
            ? 'enabled'
            : undefined

      if (deepSeekThinkingType) {
        body.thinking = { type: deepSeekThinkingType }
      }

      if (deepSeekThinkingType === 'enabled') {
        const effort = request.reasoning?.effort
        if (effort) {
          body.reasoning_effort = normalizeDeepSeekReasoningEffort(effort)
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
          params.messages as Array<{
            role?: string
            message?: { role?: string; content?: unknown }
            content?: unknown
          }>,
          effectiveTransport === 'responses_compat',
        ),
        stream: params.stream ?? false,
        store: false,
      }

      if (shouldStripResponsesStore) {
        delete responsesBody.store
      }

      if (!Array.isArray(responsesBody.input) || responsesBody.input.length === 0) {
        responsesBody.input = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: effectiveTransport === 'responses_compat' ? 'text' : 'input_text', text: '' }],
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

      if (params.temperature !== undefined) responsesBody.temperature = params.temperature
      if (params.top_p !== undefined) responsesBody.top_p = params.top_p
      if (request.reasoning?.effort) {
        responsesBody.reasoning_effort = request.reasoning.effort
        responsesBody.reasoning_summary = 'auto'
        responsesBody.include = ['reasoning.encrypted_content']
      }

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

    // Anthropic Messages API body — used when endpointPath is /messages.
    // params.messages, params.tools, etc. are already in Anthropic format
    // (they originate from the Anthropic SDK). We pass them through directly,
    // only adding the top-level system (as string or content-block array)
    // and max_tokens.
    let omitAnthropicTools = false
    const buildAnthropicMessagesBody = (): Record<string, unknown> => {
      const anthropicBody: Record<string, unknown> = {
        model: request.resolvedModel,
        messages: params.messages,
        max_tokens: params.max_tokens,
        stream: params.stream ?? false,
      }

      // Pass system through in native format. The Anthropic Messages API
      // accepts either a string or an array of content blocks (with optional
      // cache_control markers). Only filter the billing header block.
      if (Array.isArray(params.system)) {
        const filtered = (params.system as Array<{ type?: string; text?: string }>)
          .filter(block => !(block.type === 'text' && (block.text ?? '').startsWith('x-anthropic-billing-header')))
        if (filtered.length > 0) anthropicBody.system = filtered
      } else if (params.system) {
        const text = typeof params.system === 'string' ? params.system : String(params.system)
        if (text && !text.startsWith('x-anthropic-billing-header')) anthropicBody.system = text
      }

      if (!omitAnthropicTools && params.tools && params.tools.length > 0) {
        anthropicBody.tools = params.tools
      }
      if (params.tool_choice) {
        anthropicBody.tool_choice = params.tool_choice
      }

      if (request.reasoning?.effort) {
        // Shim receives OpenAI effort levels (xhigh) from client.ts, but
        // Anthropic API expects 'max' not 'xhigh'. Convert for the effort field.
        const effort = request.reasoning.effort === 'xhigh' ? 'max' : request.reasoning.effort
        const modelLower = request.resolvedModel.toLowerCase()
        const isAdaptive = modelLower.includes('opus-4-7') || modelLower.includes('opus-4-6') ||
          modelLower.includes('opus-4-8') ||
          modelLower.includes('opus-4.6') || modelLower.includes('opus-4.7') ||
          modelLower.includes('opus-4.8') ||
          modelLower.includes('sonnet-4-6') || modelLower.includes('sonnet-4.6')
        const isOpus45 = modelLower.includes('opus-4-5') || modelLower.includes('opus-4.5')

        if (isAdaptive) {
          anthropicBody.thinking = { type: 'adaptive' }
          anthropicBody.effort = effort
        } else if (isOpus45) {
          anthropicBody.effort = effort
        } else if (effort === 'high' || effort === 'max') {
          anthropicBody.thinking = {
            type: 'enabled',
            budgetTokens: effort === 'max' ? 31_999 : 16_000,
          }
        }
      }

      return anthropicBody
    }

    // Google AI SDK body — used when endpointPath is /models/gemini-*.
    // Converts Anthropic-format params to Google AI SDK format.
    let omitGeminiTools = false
    const buildGeminiBody = (): Record<string, unknown> => {
      const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = []

      // Build a lookup from tool_use_id → function name so tool_result
      // blocks can emit the correct functionResponse.name (Gemini requires
      // the function name, not the Anthropic tool_use_id).
      const toolUseIdToName = new Map<string, string>()
      const messages = params.messages as Array<{
        role?: string
        content?: unknown
      }>
      for (const msg of messages) {
        if (!Array.isArray(msg.content)) continue
        for (const block of msg.content as Array<{ type?: string; id?: string; name?: string }>) {
          if (block.type === 'tool_use' && block.id && block.name) {
            toolUseIdToName.set(block.id, block.name)
          }
        }
      }

      for (const msg of messages) {
        const role = msg.role === 'assistant' ? 'model' : 'user'
        const parts: Array<Record<string, unknown>> = []

        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content })
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content as Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }>) {
            if (block.type === 'text' && block.text) {
              parts.push({ text: block.text })
            } else if (block.type === 'tool_use' && block.id && block.name) {
              parts.push({
                functionCall: {
                  name: block.name,
                  args: block.input ?? {},
                },
              })
            } else if (block.type === 'tool_result' && block.tool_use_id) {
              const funcName = toolUseIdToName.get(block.tool_use_id) ?? block.tool_use_id
              let resultContent = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? (block.content as Array<{ type?: string; text?: string }>)
                    .filter(b => b.type === 'text')
                    .map(b => b.text ?? '')
                    .join('\n')
                  : ''
              if (block.is_error) {
                resultContent = `Error: ${resultContent}`
              }
              parts.push({
                functionResponse: {
                  name: funcName,
                  response: {
                    name: funcName,
                    content: resultContent,
                  },
                },
              })
            }
          }
        }

        if (parts.length > 0) {
          contents.push({ role, parts })
        }
      }

      const geminiBody: Record<string, unknown> = { contents }

      // System instruction
      const systemText = convertSystemPrompt(params.system)
      if (systemText) {
        geminiBody.systemInstruction = { parts: [{ text: systemText }] }
      }

      // Generation config
      const genConfig: Record<string, unknown> = {}
      if (params.max_tokens !== undefined) {
        genConfig.maxOutputTokens = params.max_tokens
      } else if (maxTokensValue !== undefined) {
        genConfig.maxOutputTokens = maxTokensValue
      } else if (maxCompletionTokensValue !== undefined) {
        genConfig.maxOutputTokens = maxCompletionTokensValue
      }
      if (params.temperature !== undefined) genConfig.temperature = params.temperature
      if (params.top_p !== undefined) genConfig.topP = params.top_p
      if (request.reasoning?.effort) {
        const level = request.reasoning.effort === 'xhigh' ? 'high' : request.reasoning.effort
        genConfig.thinkingConfig = { includeThoughts: true, thinkingLevel: level }
      }
      if (Object.keys(genConfig).length > 0) {
        geminiBody.generationConfig = genConfig
      }

      // Tools — convert Anthropic tool format to Google functionDeclarations
      if (!omitGeminiTools && params.tools && params.tools.length > 0) {
        const functionDeclarations = (params.tools as Array<{
          name?: string
          description?: string
          input_schema?: Record<string, unknown>
        }>).map(tool => ({
          name: tool.name ?? '',
          description: tool.description ?? '',
          ...(tool.input_schema ? { parameters: tool.input_schema } : {}),
        }))
        if (functionDeclarations.length > 0) {
          geminiBody.tools = [{ functionDeclarations }]
        }
      }

      return geminiBody
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...filterAnthropicHeaders(shimConfig.headers),
      ...this.defaultHeaders,
      ...filterAnthropicHeaders(options?.headers),
    }

    const isGemini = isGeminiMode()
    const routeCredential = resolveRouteCredentialValue({
      routeId: runtimeShimContext.routeId,
      baseUrl: request.baseUrl,
      processEnv: process.env,
    })
    // xAI OAuth: when the active route is xAI and no API key is set, fall
    // back to a stored OAuth access token (auto-refreshed). The token is
    // sent as a Bearer to api.x.ai/v1 — same surface as an API key.
    const isXaiRoute =
      runtimeShimContext.routeId === 'xai' || isXaiBaseUrl(request.baseUrl)
    const xaiOAuthToken =
      isXaiRoute &&
      !this.providerOverride?.apiKey &&
      !routeCredential &&
      !process.env.OPENAI_API_KEY
        ? await resolveXaiAccessToken()
        : undefined
    const apiKey =
      this.providerOverride?.apiKey ??
      routeCredential ??
      process.env.OPENAI_API_KEY ??
      xaiOAuthToken ??
      ''
    const configuredAuthHeaderValue = process.env.OPENAI_AUTH_HEADER_VALUE?.trim()
    if (configuredAuthHeaderValue && /[\r\n]/.test(configuredAuthHeaderValue)) {
      throw new Error('OPENAI_AUTH_HEADER_VALUE must not contain CR/LF characters')
    }
    const customAuthHeader = process.env.OPENAI_AUTH_HEADER?.trim()
    const hasCustomAuthHeader = Boolean(
      customAuthHeader &&
      /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(customAuthHeader),
    )
    const authValue = hasCustomAuthHeader
      ? configuredAuthHeaderValue || apiKey
      : apiKey
    // Detect Azure endpoints by hostname (not raw URL) to prevent bypass via
    // path segments like https://evil.com/cognitiveservices.azure.com/
    let isAzure = isEnvTruthy(process.env.OPENAI_AZURE_STYLE)
    if (!isAzure) {
      try {
        const { hostname } = new URL(request.baseUrl)
        isAzure =
          hostname.endsWith('.azure.com') &&
          (hostname.includes('cognitiveservices') ||
            hostname.includes('openai') ||
            hostname.includes('services.ai') ||
            hostname.includes('inference.ml'))
      } catch {
        /* malformed URL — not Azure */
      }
    }

    let isBankr = false
    try {
      isBankr =
        runtimeShimContext.routeId === 'bankr' ||
        request.baseUrl.toLowerCase().includes('bankr')
    } catch { /* malformed URL — not Bankr */ }

    if (authValue) {
      if (hasCustomAuthHeader && customAuthHeader) {
        const defaultCustomAuthScheme =
          customAuthHeader.toLowerCase() === 'authorization' ? 'bearer' : 'raw'
        const customAuthScheme =
          process.env.OPENAI_AUTH_SCHEME === 'raw' ||
          process.env.OPENAI_AUTH_SCHEME === 'bearer'
            ? process.env.OPENAI_AUTH_SCHEME
            : defaultCustomAuthScheme
        headers[customAuthHeader] =
          customAuthScheme === 'bearer'
            ? `Bearer ${authValue}`
            : authValue
      } else if (isAzure) {
        // Azure uses api-key header instead of Bearer token
        headers['api-key'] = authValue
      } else if (isBankr) {
        // Bankr uses X-API-Key header instead of Bearer token
        headers['X-API-Key'] = authValue
      } else if (shimConfig.defaultAuthHeader?.name) {
        headers[shimConfig.defaultAuthHeader.name] =
          shimConfig.defaultAuthHeader.scheme === 'bearer'
            ? `Bearer ${authValue}`
            : authValue
      } else {
        headers.Authorization = `Bearer ${authValue}`
      }
    } else if (isGemini) {
      const geminiCredential = await resolveGeminiCredential(process.env)
      if (geminiCredential.kind !== 'none') {
        headers.Authorization = `Bearer ${geminiCredential.credential}`
        if (geminiCredential.kind !== 'api-key' && 'projectId' in geminiCredential && geminiCredential.projectId) {
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

    // xAI / Grok prompt caching. Pinning the session id via x-grok-conv-id
    // routes follow-up requests to the same backend so xAI can reuse the
    // cached system prompt and conversation history. Mirrors the Hermes
    // implementation (RELEASE_v0.8.0 PR #5604).
    if (isXaiRoute) {
      headers['x-grok-conv-id'] ??= getSessionId()
    }

    const buildChatCompletionsUrl = (baseUrl: string): string => {
      // Azure Cognitive Services / Azure OpenAI require a deployment-specific
      // path and an api-version query parameter.
      if (isAzure) {
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview'
        const deployment = encodeURIComponent(request.resolvedModel ?? process.env.OPENAI_MODEL ?? 'gpt-4o')

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

    const buildRequestUrl = (baseUrl: string): string => {
      if (shimConfig.endpointPath) {
        return `${baseUrl}${shimConfig.endpointPath}`
      }
      return request.transport === 'responses' || request.transport === 'responses_compat'
        ? `${baseUrl}/responses`
        : buildChatCompletionsUrl(baseUrl)
    }

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

    const bodyContainsImages = (): boolean => {
      if (request.transport === 'responses') {
        const responsesBody = buildResponsesBody()
        const input = responsesBody.input as Array<Record<string, unknown>> | undefined
        if (!Array.isArray(input)) return false
        return input.some(item => {
          const content = item.content as Array<Record<string, unknown>> | undefined
          return Array.isArray(content) && content.some(part => part.type === 'input_image')
        })
      }
      const messages = body.messages as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(messages)) return false
      return messages.some(msg => {
        const content = msg.content
        if (!Array.isArray(content)) return false
        return content.some((part: Record<string, unknown>) => part.type === 'image_url')
      })
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
        effectiveTransport === 'responses' || effectiveTransport === 'responses_compat' ? buildResponsesBody()
          : effectiveTransport === 'anthropic_messages' ? buildAnthropicMessagesBody()
          : effectiveTransport === 'gemini' ? buildGeminiBody()
          : body
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

    const maxSelfHealAttempts = isLocal
      ? localRetryBaseUrls.length + 1
      : 0
    const maxAttempts = (isGithub ? GITHUB_429_MAX_RETRIES : 1) + maxSelfHealAttempts

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
          hasImages: bodyContainsImages(),
        })
      const failureWithUrl = { ...failure, requestUrl: failure.requestUrl ?? requestUrl }
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
    const provider = request.baseUrl.includes('nvidia') ? 'nvidia-nim'
      : request.baseUrl.includes('minimax') ? 'minimax'
      : request.baseUrl.includes('xiaomimimo') || request.baseUrl.includes('mimo-v2') ? 'xiaomi-mimo'
      : request.baseUrl.includes('localhost:11434') || request.baseUrl.includes('localhost:11435') ? 'ollama'
      : request.baseUrl.includes('anthropic') ? 'anthropic'
      : 'openai'
    const { correlationId, startTime } = logApiCallStart(provider, request.resolvedModel)
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        response = await fetchWithProxyRetry(
          requestUrl,
          buildFetchInit(),
        )
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

      // After the try/catch, response is guaranteed to be defined — the catch
      // block always throws (throwClassifiedTransportError returns never).
      if (!response) continue

      if (response.ok) {
        let tokensIn = 0
        let tokensOut = 0
        // Skip clone() for streaming responses - it blocks until full body is received,
        // defeating the purpose of streaming. Usage data is already sent via
        // stream_options: { include_usage: true } and can be extracted from the stream.
        if (!params.stream) {
          try {
            const clone = response.clone()
            const data = await clone.json()
            tokensIn = data.usage?.prompt_tokens ?? 0
            tokensOut = data.usage?.completion_tokens ?? 0
          } catch { /* ignore */ }
        }
        logApiCallEnd(correlationId, startTime, request.resolvedModel, 'success', tokensIn, tokensOut, false)
        return response
      }

      if (
        isGithub &&
        response.status === 429 &&
        attempt < maxAttempts - 1
      ) {
        await response.text().catch(() => {})
        const delaySec = Math.min(
          GITHUB_429_BASE_DELAY_SEC * 2 ** attempt,
          GITHUB_429_MAX_DELAY_SEC,
        )
        await sleepMs(delaySec * 1000)
        continue
      }
      // Read body exactly once here — Response body is a stream that can only
      // be consumed a single time.
      const errorBody = await response.text().catch(() => 'unknown error')
      const rateHint =
        isGithub && response.status === 429 ? formatRetryAfterHint(response) : ''

      // If GitHub Copilot returns error about /chat/completions,
      // try the /responses endpoint (needed for GPT-5+ models)
      if (isGithub && response.status === 400) {
        if (errorBody.includes('/chat/completions') || errorBody.includes('not accessible')) {
          const responsesUrl = `${request.baseUrl}/responses`
          const responsesBody = buildResponsesBody()

          let responsesResponse!: Response
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

          if (responsesResponse.ok) {
            return responsesResponse
          }
          const responsesErrorBody = await responsesResponse.text().catch(() => 'unknown error')
          const responsesFailure = classifyOpenAIHttpFailure({
            status: responsesResponse.status,
            body: responsesErrorBody,
            hasImages: bodyContainsImages(),
          })
          let responsesErrorResponse: object | undefined
          try { responsesErrorResponse = JSON.parse(responsesErrorBody) } catch { /* raw text */ }
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
        hasImages: bodyContainsImages(),
      })

      if (
        isLocal &&
        failure.category === 'endpoint_not_found' &&
        promoteNextLocalBaseUrl('endpoint_not_found')
      ) {
        continue
      }

      const hasToolsPayload =
        effectiveTransport === 'responses' || effectiveTransport === 'responses_compat' || effectiveTransport === 'anthropic_messages' || effectiveTransport === 'gemini'
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
        omitAnthropicTools = true
        omitGeminiTools = true
        refreshSerializedBody()

        logForDebugging(
          `[OpenAIShim] self-heal retry reason=tool_call_incompatible mode=toolless method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
          { level: 'warn' },
        )
        continue
      }

      let errorResponse: object | undefined
      try { errorResponse = JSON.parse(errorBody) } catch { /* raw text */ }
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
      500, undefined, 'OpenAI shim: request loop exited unexpectedly',
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
          content?:
            | string
            | null
            | Array<{ type?: string; text?: string }>
          reasoning_content?: string | null
          extra_content?: Record<string, unknown>
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
  ) {
    const choice = data.choices?.[0]
    const content: Array<Record<string, unknown>> = []

    // Some reasoning models (e.g. GLM-5) put their chain-of-thought in
    // reasoning_content while content stays null. Preserve it as a thinking
    // block, but do not surface it as visible assistant text.
    const reasoningText = choice?.message?.reasoning_content
    if (typeof reasoningText === 'string' && reasoningText) {
      content.push({ type: 'thinking', thinking: reasoningText })
    }
    const rawContent =
      choice?.message?.content !== '' && choice?.message?.content != null
        ? choice?.message?.content
        : null
    if (typeof rawContent === 'string' && rawContent) {
      const strippedContent = stripThinkTags(rawContent)
      const rawToolCalls = choice?.message?.tool_calls
        ? null
        : parseRawToolCallsRequestedText(strippedContent)
      if (rawToolCalls) {
        for (const toolCall of rawToolCalls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: JSON.parse(toolCall.argumentsJson),
          })
        }
      } else {
        content.push({
          type: 'text',
          text: strippedContent,
        })
      }
    } else if (Array.isArray(rawContent) && rawContent.length > 0) {
      const parts: string[] = []
      for (const part of rawContent) {
        if (
          part &&
          typeof part === 'object' &&
          part.type === 'text' &&
          typeof part.text === 'string'
        ) {
          parts.push(part.text)
        }
      }
      const joined = parts.join('\n')
      if (joined) {
        const strippedContent = stripThinkTags(joined)
        const rawToolCalls = choice?.message?.tool_calls
          ? null
          : parseRawToolCallsRequestedText(strippedContent)
        if (rawToolCalls) {
          for (const toolCall of rawToolCalls) {
            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name,
              input: JSON.parse(toolCall.argumentsJson),
            })
          }
        } else {
          content.push({
            type: 'text',
            text: strippedContent,
          })
        }
      }
    }

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const input = normalizeToolArguments(
          tc.function.name,
          tc.function.arguments,
        )
        const toolExtraContent = tc.extra_content ?? choice.message.extra_content
        const toolSignature =
          geminiThoughtSignatureFromExtraContent(tc.extra_content) ??
          geminiThoughtSignatureFromExtraContent(choice.message.extra_content)
        const mergedToolExtraContent = mergeGeminiThoughtSignature(
          toolExtraContent,
          toolSignature,
        )
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
          ...(mergedToolExtraContent ? { extra_content: mergedToolExtraContent } : {}),
          ...(toolSignature ? { signature: toolSignature } : {}),
        })
      }
    }

    const stopReason =
      choice?.finish_reason === 'tool_calls' ||
      content.some(block => block.type === 'tool_use')
        ? 'tool_use'
        : choice?.finish_reason === 'length'
          ? 'max_tokens'
          : 'end_turn'

    if (choice?.finish_reason === 'content_filter' || choice?.finish_reason === 'safety') {
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
    }
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
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.messages = new OpenAIShimMessages(defaultHeaders, reasoningEffort, providerOverride)
    this.reasoningEffort = reasoningEffort
  }
}

export function createOpenAIShimClient(options: {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
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
export const __test = { convertMessages }

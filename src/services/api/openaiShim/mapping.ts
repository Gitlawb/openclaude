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

import { APIError } from '@anthropic-ai/sdk'
import {
  readCodexCredentialsAsync,
  refreshCodexAccessTokenIfNeeded,
} from '../../../utils/codexCredentials.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isBareMode, isEnvTruthy } from '../../../utils/envUtils.js'
import { resolveGeminiCredential } from '../../../utils/geminiAuth.js'
import { hydrateGeminiAccessTokenFromSecureStorage } from '../../../utils/geminiCredentials.js'
import { hydrateGithubModelsTokenFromSecureStorage } from '../../../utils/githubModelsCredentials.js'
import { resolveXaiAccessToken } from '../../../utils/xaiCredentials.js'
import { resolveOpenAIShimRuntimeContext } from '../../../integrations/runtimeMetadata.js'
import {
  isXaiBaseUrl,
  resolveRouteCredentialValue,
} from '../../../integrations/routeMetadata.js'
import { getSessionId } from '../../../bootstrap/state.js'
import {
  createThinkTagFilter,
  stripThinkTags,
} from '../thinkTagSanitizer.js'
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
} from '../codexShim.js'
import { buildAnthropicUsageFromRawUsage } from '../cacheMetrics.js'
import { compressToolHistory } from '../compressToolHistory.js'
import { fetchWithProxyRetry } from '../fetchWithProxyRetry.js'
import {
  getLocalFastPathConfig,
  getLocalProviderRetryBaseUrls,
  getGithubEndpointType,
  isLocalProviderUrl,
  resolveRuntimeCodexCredentials,
  resolveProviderRequest,
  shouldAttemptLocalToollessRetry,
  type LocalFastPathConfig,
} from '../providerConfig.js'
import {
  buildOpenAICompatibilityErrorMessage,
  classifyOpenAIHttpFailure,
  classifyOpenAINetworkFailure,
} from '../openaiErrorClassification.js'
import { sanitizeSchemaForOpenAICompat } from '../../../utils/schemaSanitizer.js'
import { redactSecretValueForDisplay } from '../../../utils/providerProfile.js'
import { shouldRedactUrlQueryParam } from '../../../utils/urlRedaction.js'
import {
  normalizeToolArguments,
  hasToolFieldMapping,
} from '../toolArgumentNormalization.js'
import { logApiCallStart, logApiCallEnd } from '../../../utils/requestLogging.js'
import {
  createStreamState,
  processStreamChunk,
  getStreamStats,
} from '../../../utils/streamingOptimizer.js'
import { stableStringifyJson } from '../../../utils/stableStringify.js'

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
const COPILOT_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'Editor-Version': 'vscode/1.99.3',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
}

import { isGithubModelsMode, filterAnthropicHeaders, hasGeminiApiHost, isGeminiModelName, shouldPreserveGeminiThoughtSignature, geminiThoughtSignatureFromExtraContent, mergeGeminiThoughtSignature, hasCerebrasApiHost, normalizeDeepSeekReasoningEffort, formatRetryAfterHint, redactUrlForDiagnostics, redactUrlsInMessage, sleepMs, isGeminiMode, hydrateOpenAIShimCompatibilityEnv, OpenAIMessage, OpenAITool } from './metadata.js';
import { openaiStreamToAnthropic, OpenAIStreamChunk } from './stream.js';
import { OpenAIShimStream, OpenAIShimMessages, OpenAIShimBeta, createOpenAIShimClient } from './client.js';

export function convertSystemPrompt(
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

export function convertToolResultContent(
  content: unknown,
  isError?: boolean,
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
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

  return parts
}

export function convertContentBlocks(
  content: unknown,
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
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

  return parts
}

export function convertMessages(
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
          (b: { type?: string }) => b.type === 'thinking',
        )
        const textContent = content.filter(
          (b: { type?: string }) => b.type !== 'tool_use' && b.type !== 'thinking',
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
          const thinkingText = (thinkingBlock as { thinking?: string } | undefined)?.thinking
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
    // If a 'tool' result is followed by a 'user' message, we must inject a semantic
    // assistant response to satisfy the strict role sequence:
    // ... -> assistant (calls) -> tool (results) -> assistant (semantic) -> user (next)
    if (prev && prev.role === 'tool' && msg.role === 'user') {
      coalesced.push({
        role: 'assistant',
        content: '[Tool execution interrupted by user]',
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
            | Array<{ type: string; text?: string; image_url?: { url: string } }>
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
export function normalizeSchemaForOpenAI(
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

export function convertTools(
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

export interface OpenAIStreamChunk {
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

export function makeMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '')}`
}

export function convertChunkUsage(
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

export const JSON_REPAIR_SUFFIXES = [
  '}', '"}', ']}', '"]}', '}}', '"}}', ']}}', '"]}}', '"]}]}', '}]}'
]

export const RAW_TOOL_CALLS_REQUESTED_PREFIX = 'Tool calls requested:'

export type ParsedRawToolCall = {
  id: string
  name: string
  argumentsJson: string
}

export function couldBeRawToolCallsRequestedPrefix(text: string): boolean {
  const trimmedStart = text.trimStart()
  return (
    RAW_TOOL_CALLS_REQUESTED_PREFIX.startsWith(trimmedStart) ||
    trimmedStart.startsWith(RAW_TOOL_CALLS_REQUESTED_PREFIX)
  )
}

export function parseRawToolCallsRequestedText(text: string): ParsedRawToolCall[] | null {
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

export function repairPossiblyTruncatedObjectJson(raw: string): string | null {
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

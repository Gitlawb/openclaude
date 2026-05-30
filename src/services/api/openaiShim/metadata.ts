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

import { convertMessages, normalizeSchemaForOpenAI, convertTools, makeMessageId, convertChunkUsage, couldBeRawToolCallsRequestedPrefix, parseRawToolCallsRequestedText, repairPossiblyTruncatedObjectJson, OpenAIMessage, OpenAITool, ParsedRawToolCall, JSON_REPAIR_SUFFIXES } from './mapping.js';
import { openaiStreamToAnthropic, OpenAIStreamChunk } from './stream.js';
import { OpenAIShimStream, OpenAIShimMessages, OpenAIShimBeta, createOpenAIShimClient } from './client.js';

export function isGithubModelsMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
}

export function filterAnthropicHeaders(
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

export function hasGeminiApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    return new URL(baseUrl).hostname.toLowerCase() === GEMINI_API_HOST
  } catch {
    return false
  }
}

export function isGeminiModelName(model: string | undefined): boolean {
  const normalized = model?.trim().toLowerCase()
  return (
    normalized?.startsWith('google/gemini-') === true ||
    normalized?.startsWith('gemini-') === true
  )
}

export function shouldPreserveGeminiThoughtSignature(
  model: string | undefined,
  baseUrl?: string,
): boolean {
  return isGeminiMode() || hasGeminiApiHost(baseUrl) || isGeminiModelName(model)
}

export function geminiThoughtSignatureFromExtraContent(
  extraContent: unknown,
): string | undefined {
  if (!extraContent || typeof extraContent !== 'object') return undefined
  const google = (extraContent as Record<string, unknown>).google
  if (!google || typeof google !== 'object') return undefined
  const signature = (google as Record<string, unknown>).thought_signature
  return typeof signature === 'string' && signature.length > 0 ? signature : undefined
}

export function mergeGeminiThoughtSignature(
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

export function hasCerebrasApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.cerebras.ai' || host.endsWith('.cerebras.ai')
  } catch {
    return false
  }
}

export function normalizeDeepSeekReasoningEffort(
  effort: 'low' | 'medium' | 'high' | 'xhigh',
): 'high' | 'max' {
  return effort === 'xhigh' ? 'max' : 'high'
}

export function formatRetryAfterHint(response: Response): string {
  const ra = response.headers.get('retry-after')
  return ra ? ` (Retry-After: ${ra})` : ''
}

export function redactUrlForDiagnostics(url: string): string {
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

export function redactUrlsInMessage(message: string): string {
  return message.replace(/https?:\/\/\S+/g, match => redactUrlForDiagnostics(match))
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Types — minimal subset of Anthropic SDK types we need to produce
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Message format conversion: Anthropic → OpenAI
// ---------------------------------------------------------------------------

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
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

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

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

export function isGeminiMode(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI) ||
    hasGeminiApiHost(process.env.OPENAI_BASE_URL)
  )
}

export function hydrateOpenAIShimCompatibilityEnv(
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

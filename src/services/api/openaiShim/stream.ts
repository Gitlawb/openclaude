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
import { convertSystemPrompt, convertToolResultContent, convertContentBlocks, convertMessages, normalizeSchemaForOpenAI, convertTools, makeMessageId, convertChunkUsage, couldBeRawToolCallsRequestedPrefix, parseRawToolCallsRequestedText, repairPossiblyTruncatedObjectJson, ParsedRawToolCall, JSON_REPAIR_SUFFIXES } from './mapping.js';
import { OpenAIShimStream, OpenAIShimMessages, OpenAIShimBeta, createOpenAIShimClient } from './client.js';

/**
 * Async generator that transforms an OpenAI SSE stream into
 * Anthropic-format BetaRawMessageStreamEvent objects.
 */
export async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
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

  const reader = response.body?.getReader()
  if (!reader) return

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
  async function readWithTimeout(): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
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

          if (
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
          // Close any open content blocks
          if (hasEmittedContentStart) {
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

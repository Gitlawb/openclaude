import { createHash } from 'crypto'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { roughTokenCountEstimation, roughTokenCountEstimationForMessages } from '../services/tokenEstimation.js'
import type { AssistantMessage, Message } from '../types/message.js'
import { SYNTHETIC_MESSAGES, SYNTHETIC_MODEL } from './messages.js'
import { jsonStringify } from './slowOperations.js'
import { InMemoryTokenCache } from './inMemoryTokenCache.js'

let _inMemoryTokenCache: InMemoryTokenCache | undefined

export function getInMemoryTokenCache(): InMemoryTokenCache {
  if (!_inMemoryTokenCache) {
    _inMemoryTokenCache = new InMemoryTokenCache(200, 48 * 60 * 60 * 1000)
  }
  return _inMemoryTokenCache
}

export const inMemoryTokenCache = { get cache() { return getInMemoryTokenCache() } }

function cachedTokenCount(content: string): number {
  if (content.length < 20) {
    return roughTokenCountEstimation(content)
  }
  return getInMemoryTokenCache().getTokenCount(content)
}

function getMessageHash(message: Message): string {
  return createHash('sha256')
    .update(jsonStringify(message.message?.content ?? ''))
    .digest('hex')
    .slice(0, 16)
}

function cachedMessageTokenEstimate(message: Message): number {
  const hash = getMessageHash(message)
  const cache = getInMemoryTokenCache()
  const existing = cache.cache.get(hash)
  if (existing) {
    return existing.tokenCount
  }
  const estimate = getMessageTokenEstimate(message)
  cache.cache.set(hash, { contentHash: hash, contentPreview: '', tokenCount: estimate, lastUsed: Date.now(), useCount: 1 })
  return estimate
}

function getMessageContentString(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c
      if (typeof c === 'object' && c !== null) {
        if ('text' in c) return (c as any).text ?? ''
        if ('type' in c) return JSON.stringify(c)
      }
      return ''
    }).join('\n')
  }
  return ''
}

function getMessageTokenEstimate(message: Message): number {
  const content = message.message?.content
  if (typeof content === 'string') {
    return roughTokenCountEstimation(content)
  }
  if (Array.isArray(content)) {
    let tokens = 0
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>
        if (b.type === 'image') {
          tokens += 2000
        } else if (b.type === 'document') {
          tokens += 500
        } else if ('text' in b && typeof b.text === 'string') {
          tokens += roughTokenCountEstimation(b.text)
        } else if ('thinking' in b && typeof b.thinking === 'string') {
          tokens += roughTokenCountEstimation(b.thinking)
        } else if ('tool_use' in b || 'tool_result' in b) {
          tokens += 200
        } else {
          tokens += roughTokenCountEstimation(JSON.stringify(block))
        }
      }
    }
    return tokens
  }
  return 0
}

function cachedRoughTokenCountForMessages(messages: readonly Message[]): number {
  let total = 0
  for (const msg of messages) {
    total += cachedMessageTokenEstimate(msg)
  }
  return total
}

export function getTokenUsage(message: Message): Usage | undefined {
  if (
    message?.type === 'assistant' &&
    'usage' in message.message &&
    !(
      message.message.content[0]?.type === 'text' &&
      SYNTHETIC_MESSAGES.has(message.message.content[0].text)
    ) &&
    message.message.model !== SYNTHETIC_MODEL
  ) {
    return message.message.usage
  }
  return undefined
}

/**
 * Get the API response id for an assistant message with real (non-synthetic) usage.
 * Used to identify split assistant records that came from the same API response —
 * when parallel tool calls are streamed, each content block becomes a separate
 * AssistantMessage record, but they all share the same message.id.
 */
function getAssistantMessageId(message: Message): string | undefined {
  if (
    message?.type === 'assistant' &&
    'id' in message.message &&
    message.message.model !== SYNTHETIC_MODEL
  ) {
    return message.message.id
  }
  return undefined
}

/**
 * Calculate total context window tokens from an API response's usage data.
 * Includes input_tokens + cache tokens + output_tokens.
 *
 * This represents the full context size at the time of that API call.
 * Use tokenCountWithEstimation() when you need context size from messages.
 */
export function getTokenCountFromUsage(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    usage.output_tokens
  )
}

export function tokenCountFromLastAPIResponse(messages: Message[]): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      return getTokenCountFromUsage(usage)
    }
    i--
  }
  return 0
}

/**
 * Final context window size from the last API response's usage.iterations[-1].
 * Used for task_budget.remaining computation across compaction boundaries —
 * the server's budget countdown is context-based, so remaining decrements by
 * the pre-compact final window, not billing spend. See monorepo
 * api/api/sampling/prompt/renderer.py:292 for the server-side computation.
 *
 * Falls back to top-level input_tokens + output_tokens when iterations is
 * absent (no server-side tool loops, so top-level usage IS the final window).
 * Both paths exclude cache tokens to match #304930's formula.
 */
export function finalContextTokensFromLastResponse(
  messages: Message[],
): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      // Stainless types don't include iterations yet — cast like advisor.ts:43
      const iterations = (
        usage as {
          iterations?: Array<{
            input_tokens: number
            output_tokens: number
          }> | null
        }
      ).iterations
      if (iterations && iterations.length > 0) {
        const last = iterations.at(-1)!
        return last.input_tokens + last.output_tokens
      }
      // No iterations → no server tool loop → top-level usage IS the final
      // window. Match the iterations path's formula (input + output, no cache)
      // rather than getTokenCountFromUsage — #304930 defines final window as
      // non-cache input + output. Whether the server's budget countdown
      // (renderer.py:292 calculate_context_tokens) counts cache the same way
      // is an open question; aligning with the iterations path keeps the two
      // branches consistent until that's resolved.
      return usage.input_tokens + usage.output_tokens
    }
    i--
  }
  return 0
}

/**
 * Get only the output_tokens from the last API response.
 * This excludes input context (system prompt, tools, prior messages).
 *
 * WARNING: Do NOT use this for threshold comparisons (autocompact, session memory).
 * Use tokenCountWithEstimation() instead, which measures full context size.
 * This function is only useful for measuring how many tokens Claude generated
 * in a single response, not how full the context window is.
 */
export function messageTokenCountFromLastAPIResponse(
  messages: Message[],
): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      return usage.output_tokens
    }
    i--
  }
  return 0
}

export function getCurrentUsage(messages: Message[]): {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      return {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      }
    }
  }
  return null
}

export function doesMostRecentAssistantMessageExceed200k(
  messages: Message[],
): boolean {
  const THRESHOLD = 200_000

  const lastAsst = messages.findLast(m => m.type === 'assistant')
  if (!lastAsst) return false
  const usage = getTokenUsage(lastAsst)
  return usage ? getTokenCountFromUsage(usage) > THRESHOLD : false
}

/**
 * Calculate the character content length of an assistant message.
 * Used for spinner token estimation (characters / 4 ≈ tokens).
 * This is used when subagent streaming events are filtered out and we
 * need to count content from completed messages instead.
 *
 * Counts the same content that handleMessageFromStream would count via deltas:
 * - text (text_delta)
 * - thinking (thinking_delta)
 * - redacted_thinking data
 * - tool_use input (input_json_delta)
 * Note: signature_delta is excluded from streaming counts (not model output).
 */
export function getAssistantMessageContentLength(
  message: AssistantMessage,
): number {
  let contentLength = 0
  for (const block of message.message.content) {
    if (block.type === 'text') {
      contentLength += block.text.length
    } else if (block.type === 'thinking') {
      contentLength += block.thinking.length
    } else if (block.type === 'redacted_thinking') {
      contentLength += block.data.length
    } else if (block.type === 'tool_use') {
      contentLength += jsonStringify(block.input).length
    }
  }
  return contentLength
}

/**
 * Extract thinking tokens from an assistant message.
 * Returns breakdown of thinking vs output tokens.
 */
export function extractThinkingTokens(
  message: AssistantMessage,
): { thinking: number; output: number; total: number } {
  let thinking = 0
  let output = 0

  for (const block of message.message.content) {
    if (block.type === 'thinking') {
      thinking += roughTokenCountEstimation(block.thinking)
    } else if (block.type === 'redacted_thinking') {
      thinking += roughTokenCountEstimation(block.data)
    } else if (block.type === 'text') {
      output += roughTokenCountEstimation(block.text)
    } else if (block.type === 'tool_use') {
      output += roughTokenCountEstimation(jsonStringify(block.input))
    }
  }

  return { thinking, output, total: thinking + output }
}

/**
 * Token usage history entry for tracking patterns over time.
 */
export interface TokenUsageEntry {
  timestamp: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  model: string
}

/**
 * Token analytics summary from historical data.
 */
export interface TokenAnalytics {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheRead: number
  totalCacheCreation: number
  averageInputPerRequest: number
  averageOutputPerRequest: number
  cacheHitRate: number
  mostUsedModel: string
  requestsLastHour: number
  requestsLastDay: number
}

/**
 * Historical Token Analytics Tracker
 * 
 * Tracks token usage patterns over time for analytics,
 * cost optimization, and capacity planning.
 */
export class TokenUsageTracker {
  private history: TokenUsageEntry[] = []
  private readonly maxEntries: number

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries
  }

  /**
   * Record a token usage event from API response.
   */
  record(usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    model: string
  }): void {
    const entry: TokenUsageEntry = {
      timestamp: Date.now(),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      model: usage.model,
    }

    this.history.push(entry)

    // Trim old entries
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(-this.maxEntries)
    }
  }

  /**
   * Get analytics summary for all recorded usage.
   */
  getAnalytics(): TokenAnalytics {
    if (this.history.length === 0) {
      return {
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        averageInputPerRequest: 0,
        averageOutputPerRequest: 0,
        cacheHitRate: 0,
        mostUsedModel: 'unknown',
        requestsLastHour: 0,
        requestsLastDay: 0,
      }
    }

    const now = Date.now()
    const hourAgo = now - 60 * 60 * 1000
    const dayAgo = now - 24 * 60 * 60 * 1000

    let totalInput = 0
    let totalOutput = 0
    let totalCacheRead = 0
    let totalCacheCreation = 0
    let modelCounts = new Map<string, number>()
    let requestsLastHour = 0
    let requestsLastDay = 0

    for (const entry of this.history) {
      totalInput += entry.inputTokens
      totalOutput += entry.outputTokens
      totalCacheRead += entry.cacheReadTokens
      totalCacheCreation += entry.cacheCreationTokens

      modelCounts.set(entry.model, (modelCounts.get(entry.model) ?? 0) + 1)

      if (entry.timestamp >= hourAgo) requestsLastHour++
      if (entry.timestamp >= dayAgo) requestsLastDay++
    }

    // Find most used model
    let mostUsedModel = 'unknown'
    let maxCount = 0
    for (const [model, count] of modelCounts) {
      if (count > maxCount) {
        maxCount = count
        mostUsedModel = model
      }
    }

    const totalRequests = this.history.length
    const totalCache = totalCacheRead + totalCacheCreation
    const totalTokens = totalInput + totalOutput + totalCache
    const cacheHitRate = totalTokens > 0 ? (totalCacheRead / totalTokens) * 100 : 0

    return {
      totalRequests,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheRead,
      totalCacheCreation,
      averageInputPerRequest: Math.round(totalInput / totalRequests),
      averageOutputPerRequest: Math.round(totalOutput / totalRequests),
      cacheHitRate: Math.round(cacheHitRate),
      mostUsedModel,
      requestsLastHour,
      requestsLastDay,
    }
  }

  /**
   * Get recent entries within time window.
   */
  getRecent(windowMs: number): TokenUsageEntry[] {
    const cutoff = Date.now() - windowMs
    return this.history.filter(e => e.timestamp >= cutoff)
  }

  /**
   * Clear history.
   */
  clear(): void {
    this.history = []
  }

  /**
   * Get history size.
   */
  get size(): number {
    return this.history.length
  }
}

/**
 * Get the current context window size in tokens.
 *
 * This is the CANONICAL function for measuring context size when checking
 * thresholds (autocompact, session memory init, etc.). Uses the last API
 * response's token count (input + output + cache) plus estimates for any
 * messages added since.
 *
 * Always use this instead of:
 * - Cumulative token counting (which double-counts as context grows)
 * - messageTokenCountFromLastAPIResponse (which only counts output_tokens)
 * - tokenCountFromLastAPIResponse (which doesn't estimate new messages)
 *
 * Implementation note on parallel tool calls: when the model makes multiple
 * tool calls in one response, the streaming code emits a SEPARATE assistant
 * record per content block (all sharing the same message.id and usage), and
 * the query loop interleaves each tool_result immediately after its tool_use.
 * So the messages array looks like:
 *   [..., assistant(id=A), user(result), assistant(id=A), user(result), ...]
 * If we stop at the LAST assistant record, we only estimate the one tool_result
 * after it and miss all the earlier interleaved tool_results — which will ALL
 * be in the next API request. To avoid undercounting, after finding a usage-
 * bearing record we walk back to the FIRST sibling with the same message.id
 * so every interleaved tool_result is included in the rough estimate.
 */
export function tokenCountWithEstimation(messages: readonly Message[]): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (message && usage) {
      // Walk back past any earlier sibling records split from the same API
      // response (same message.id) so interleaved tool_results between them
      // are included in the estimation slice.
      const responseId = getAssistantMessageId(message)
      if (responseId) {
        let j = i - 1
        while (j >= 0) {
          const prior = messages[j]
          const priorId = prior ? getAssistantMessageId(prior) : undefined
          if (priorId === responseId) {
            // Earlier split of the same API response — anchor here instead.
            i = j
          } else if (priorId !== undefined) {
            // Hit a different API response — stop walking.
            break
          }
          // priorId === undefined: a user/tool_result/attachment message,
          // possibly interleaved between splits — keep walking.
          j--
        }
      }
      return (
        getTokenCountFromUsage(usage) +
        cachedRoughTokenCountForMessages(messages.slice(i + 1))
      )
    }
    i--
  }
  return cachedRoughTokenCountForMessages(messages)
}

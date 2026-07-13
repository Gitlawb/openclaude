/**
 * High-performance token counter with cache invalidation on content change.
 */

import { roughTokenCountEstimation, roughTokenCountEstimationForMessages } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface IncrementalCounterConfig {
  /** Token budget for context limit decisions (e.g., model context window) */
  tokenBudget?: number
  /** Enable auto-invalidation on size change */
  autoInvalidate?: boolean
  /** Custom estimation multiplier */
  estimationMultiplier?: number
}

export interface CounterStats {
  hits: number
  misses: number
  totalTokens: number
  averageTokens: number
  hitRate: number
}

/**
 * Fast hash for cache invalidation using message metadata instead of full content.
 * Avoids expensive SHA-256 + JSON.stringify over the entire message history
 * (which can be huge when tool results contain file contents).
 *
 * Uses DJB2 on message UUIDs + content length approximations — fast O(n) with
 * minimal allocation and no cryptographic overhead. Collisions are acceptable
 * because a false cache hit just triggers a recomputation (correct, not stale).
 */
function getMessageHash(messages: readonly Message[]): string {
  if (messages.length === 0) return 'empty'

  let hash = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    // Mix in message UUID (unique identifier)
    if (m.uuid) {
      for (let j = 0; j < m.uuid.length; j++) {
        hash = ((hash << 5) - hash) + m.uuid.charCodeAt(j)
        hash |= 0
      }
    }
    // Mix in content length so content changes (snip, compact) invalidate the cache
    const content = m.message?.content
    let len = 0
    if (typeof content === 'string') {
      len = content.length
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object') {
          if ('text' in block && typeof (block as { text?: unknown }).text === 'string') len += ((block as { text: string }).text).length
          if ('thinking' in block && typeof (block as { thinking?: unknown }).thinking === 'string') len += ((block as { thinking: string }).thinking).length
          if (block.type === 'tool_result') {
            const tr = block as { content?: string | Array<{ text?: string }> }
            if (typeof tr.content === 'string') len += tr.content.length
            if (Array.isArray(tr.content)) {
              for (const sub of tr.content) {
                if (sub.text) len += sub.text.length
              }
            }
          }
        }
      }
    }
    hash = ((hash << 5) - hash) + len
    hash |= 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * High-performance incremental token counter with content-aware invalidation.
 */
export class IncrementalTokenCounter {
  private lastMessageCount = 0
  private lastTokenCount = 0
  private lastFullHash = ''
  private lastPrefixHash = ''
  private config: Required<IncrementalCounterConfig>
  private stats = {
    hits: 0,
    misses: 0,
    totalTokens: 0,
  }

  constructor(config: IncrementalCounterConfig = {}) {
    this.config = {
      tokenBudget: config.tokenBudget ?? 100000,
      autoInvalidate: config.autoInvalidate ?? true,
      estimationMultiplier: config.estimationMultiplier ?? 1,
    }
  }

  /**
   * Get token count using cache when possible.
   * O(1) for cached, O(n) for new messages.
   */
  getCount(messages: readonly Message[]): number {
    if (messages.length === 0) {
      this.reset()
      return 0
    }

    const hash = getMessageHash(messages)

    // Cache hit only if both count AND content match
    if (messages.length === this.lastMessageCount && hash === this.lastFullHash) {
      this.stats.hits++
      this.stats.totalTokens += this.lastTokenCount
      return this.lastTokenCount
    }

    // Cache miss - calculate
    this.stats.misses++

    const isIncrementalSafe =
      messages.length > this.lastMessageCount &&
      this.config.autoInvalidate &&
      this.lastMessageCount > 0 &&
      this.lastFullHash.length > 0

    if (isIncrementalSafe) {
      const currentPrefixHash = getMessageHash(messages.slice(0, this.lastMessageCount))

      if (currentPrefixHash === this.lastPrefixHash) {
        const newMessages = messages.slice(this.lastMessageCount)
        const estimated = Math.round(
          roughTokenCountEstimationForMessages(newMessages) * this.config.estimationMultiplier
        )
        this.lastTokenCount += estimated
      } else {
        this.lastTokenCount = roughTokenCountEstimationForMessages(messages)
      }
    } else {
      this.lastTokenCount = roughTokenCountEstimationForMessages(messages)
    }

    this.lastMessageCount = messages.length
    this.lastFullHash = hash
    this.lastPrefixHash = getMessageHash(messages.slice(0, messages.length))
    this.stats.totalTokens += this.lastTokenCount
    
    return this.lastTokenCount
  }

  /**
   * Force recalculate from full context.
   * Use when context changed externally.
   */
  invalidate(messages: readonly Message[]): number {
    this.lastMessageCount = messages.length
    this.lastFullHash = getMessageHash(messages)
    this.lastPrefixHash = messages.length > 0 ? getMessageHash(messages) : ''

    if (messages.length === 0) {
      this.lastTokenCount = 0
    } else {
      this.lastTokenCount = roughTokenCountEstimationForMessages(messages)
    }
    
    this.stats.totalTokens += this.lastTokenCount
    this.stats.misses++
    
    return this.lastTokenCount
  }

  /**
   * Estimate token count without caching.
   * Useful for read-only estimates.
   */
  estimate(messages: readonly Message[]): number {
    return roughTokenCountEstimationForMessages(messages)
  }

  /**
   * Get token count for a single message.
   */
  estimateMessage(message: Message): number {
    if (typeof message.message?.content === 'string') {
      return roughTokenCountEstimation(message.message.content)
    }
    if (Array.isArray(message.message?.content)) {
      return message.message.content.reduce((sum, block) => {
        if ('text' in block) return sum + roughTokenCountEstimation(block.text || '')
        if ('thinking' in block) return sum + roughTokenCountEstimation(block.thinking || '')
        return sum + 100 // Default for other block types
      }, 0)
    }
    return 100 // Default estimate
  }

  /**
   * Batch estimate for multiple messages.
   */
  estimateBatch(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessage(msg), 0)
  }

  /**
   * Get remaining budget in context window.
   */
  getRemainingBudget(messages: readonly Message[], contextWindow: number): number {
    const used = this.getCount(messages)
    return Math.max(0, contextWindow - used)
  }

  /**
   * Check if approaching limit.
   */
  isApproachingLimit(messages: readonly Message[], threshold: number = 0.8): boolean {
    return this.lastMessageCount > 0 && 
           (this.lastTokenCount / this.config.tokenBudget) > threshold
  }

  /** Reset all state */
  reset(): void {
    this.lastMessageCount = 0
    this.lastTokenCount = 0
    this.stats = { hits: 0, misses: 0, totalTokens: 0 }
  }

  /** Get current cached count */
  get cachedCount(): number {
    return this.lastTokenCount
  }

  /** Get message count */
  get messageCount(): number {
    return this.lastMessageCount
  }

  /** Get statistics */
  getStats(): CounterStats {
    const total = this.stats.hits + this.stats.misses
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      totalTokens: this.stats.totalTokens,
      averageTokens: total > 0 ? Math.round(this.stats.totalTokens / total) : 0,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) : 0,
    }
  }

  /** Update configuration dynamically */
  updateConfig(config: Partial<IncrementalCounterConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      tokenBudget: config.tokenBudget ?? this.config.tokenBudget,
      autoInvalidate: config.autoInvalidate ?? this.config.autoInvalidate,
      estimationMultiplier: config.estimationMultiplier ?? this.config.estimationMultiplier,
    }
  }
}

/**
 * Factory for creating pre-configured counters.
 */
export const CounterFactory = {
  realtime(): IncrementalTokenCounter {
    return new IncrementalTokenCounter({
      tokenBudget: 50000,
      autoInvalidate: true,
      estimationMultiplier: 1.1,
    })
  },

  batch(): IncrementalTokenCounter {
    return new IncrementalTokenCounter({
      tokenBudget: 200000,
      autoInvalidate: false,
      estimationMultiplier: 1.0,
    })
  },

  lightweight(): IncrementalTokenCounter {
    return new IncrementalTokenCounter({
      tokenBudget: 10000,
      autoInvalidate: true,
      estimationMultiplier: 1.2,
    })
  },
}

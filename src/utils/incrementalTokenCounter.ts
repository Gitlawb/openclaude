/**
 * High-performance token counter with cache invalidation on content change.
 */

import { createHash } from 'crypto'
import { roughTokenCountEstimation, roughTokenCountEstimationForMessages } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface IncrementalCounterConfig {
  /** Maximum cache size */
  maxCacheSize?: number
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
 * Get a hash of full conversation history for cache validation.
 * Hashes ALL messages with full content to prevent collisions.
 */
function getMessageHash(messages: readonly Message[]): string {
  if (messages.length === 0) return 'empty'

  const fullContent = messages.map(m => {
    const c = typeof m.message?.content === 'string'
      ? m.message.content
      : Array.isArray(m.message?.content)
        ? JSON.stringify(m.message.content)
        : ''
    return c
  }).join('|')

  return createHash('sha256').update(fullContent).digest('hex').slice(0, 16)
}

/**
 * High-performance incremental token counter with content-aware invalidation.
 */
export class IncrementalTokenCounter {
  private lastMessageCount = 0
  private lastTokenCount = 0
  private lastHash = ''
  private config: Required<IncrementalCounterConfig>
  private stats = {
    hits: 0,
    misses: 0,
    totalTokens: 0,
  }

  constructor(config: IncrementalCounterConfig = {}) {
    this.config = {
      maxCacheSize: config.maxCacheSize ?? 1000,
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
    if (messages.length === this.lastMessageCount && hash === this.lastHash) {
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
      this.lastHash.length > 0

    if (isIncrementalSafe) {
      const prefixHash = getMessageHash(messages.slice(0, this.lastMessageCount))
      const previousPrefixLength = this.lastHash.length

      if (prefixHash.length === previousPrefixLength) {
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
    this.lastHash = hash
    this.stats.totalTokens += this.lastTokenCount
    
    return this.lastTokenCount
  }

  /**
   * Force recalculate from full context.
   * Use when context changed externally.
   */
  invalidate(messages: readonly Message[]): number {
    this.lastMessageCount = messages.length
    this.lastHash = getMessageHash(messages)
    
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
           (this.lastTokenCount / this.config.maxCacheSize) > threshold
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
      maxCacheSize: config.maxCacheSize ?? this.config.maxCacheSize,
      autoInvalidate: config.autoInvalidate ?? this.config.autoInvalidate,
      estimationMultiplier: config.estimationMultiplier ?? this.config.estimationMultiplier,
    }
  }
}

/**
 * Factory for creating pre-configured counters.
 */
export const CounterFactory = {
  /**
   * Create a high-performance counter for real-time use.
   */
  realtime(): IncrementalTokenCounter {
    return new IncrementalTokenCounter({
      maxCacheSize: 500,
      autoInvalidate: true,
      estimationMultiplier: 1.1,
    })
  },

  /**
   * Create a conservative counter for batch processing.
   */
  batch(): IncrementalTokenCounter {
    return new IncrementalTokenCounter({
      maxCacheSize: 10000,
      autoInvalidate: false,
      estimationMultiplier: 1.0,
    })
  },

  /**
   * Create a memory-efficient counter.
   */
  lightweight(): IncrementalTokenCounter {
    return new IncrementalTokenCounter({
      maxCacheSize: 100,
      autoInvalidate: true,
      estimationMultiplier: 1.2,
    })
  },
}
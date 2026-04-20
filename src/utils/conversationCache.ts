/**
 * Conversation Cache - LRU cache for conversation history
 * 
 * Provides efficient in-memory caching with LRU eviction
 * for conversation messages to reduce memory usage.
 * 
 * Uses Map for O(1) access order tracking (instead of array filtering).
 */

export interface CacheEntry<T> {
  value: T
  timestamp: number
  hits: number
}

export interface ConversationCacheConfig {
  maxSize?: number
  ttlMs?: number
}

export class ConversationCache {
  private cache = new Map<string, CacheEntry<Message[]>>()
  private accessOrder = new Map<string, number>()
  private evictions = 0

  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(config: ConversationCacheConfig = {}) {
    this.maxSize = config.maxSize ?? 100
    this.ttlMs = config.ttlMs ?? 24 * 60 * 60 * 1000 // 24 hours default
  }

  get size(): number {
    return this.cache.size
  }

  get evictionCount(): number {
    return this.evictions
  }

  set(key: string, messages: Message[]): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      value: messages,
      timestamp: Date.now(),
      hits: 0,
    })
    this.accessOrder.set(key, this.accessOrder.size)
  }

  get(key: string): Message[] | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key)
      return undefined
    }

    entry.hits++
    this.accessOrder.set(key, this.accessOrder.size)
    return entry.value
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key)
      return false
    }
    return true
  }

  delete(key: string): boolean {
    this.accessOrder.delete(key)
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder.clear()
  }

  getStats(): { size: number; evictions: number; hits: number } {
    let totalHits = 0
    for (const entry of this.cache.values()) {
      totalHits += entry.hits
    }
    return {
      size: this.cache.size,
      evictions: this.evictions,
      hits: totalHits,
    }
  }

  prune(): number {
    const now = Date.now()
    let pruned = 0
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key)
      this.accessOrder.delete(key)
      pruned++
    }

    return pruned
  }

  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestOrder = Infinity

    for (const [key, order] of this.accessOrder.entries()) {
      if (order < oldestOrder) {
        oldestOrder = order
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      this.accessOrder.delete(oldestKey)
      this.evictions++
    }
  }
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_calls?: unknown[]
  tool_use_id?: string
  timestamp?: number
}

export type CacheMessage = Message

export function createConversationCache(
  config?: ConversationCacheConfig,
): ConversationCache {
  return new ConversationCache(config)
}

/**
 * @deprecated maxMemoryMb is no longer supported as memory tracking
 * requires serializing/deserializing all cached content. Use maxSize instead.
 */
export function createConversationCacheWithMemoryLimit(
  _config?: ConversationCacheConfig & { maxMemoryMb?: never },
): ConversationCache {
  console.warn(
    'maxMemoryMb is deprecated. Use createConversationCache() with maxSize instead.',
  )
  return new ConversationCache(_config)
}
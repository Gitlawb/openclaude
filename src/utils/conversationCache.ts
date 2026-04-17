/**
 * Conversation Cache - LRU cache for conversation history
 * 
 * Provides efficient in-memory caching with LRU eviction
 * for conversation messages to reduce memory usage.
 */

export interface CacheEntry<T> {
  value: T
  timestamp: number
  hits: number
}

export interface ConversationCacheConfig {
  maxSize?: number
  ttlMs?: number
  maxMemoryMb?: number
}

export class ConversationCache {
  private cache = new Map<string, CacheEntry<Message[]>>()
  private accessOrder: string[] = []
  private evictions = 0

  private readonly maxSize: number
  private readonly ttlMs: number
  private readonly maxMemoryMb: number

  constructor(config: ConversationCacheConfig = {}) {
    this.maxSize = config.maxSize ?? 100
    this.ttlMs = config.ttlMs ?? 24 * 60 * 60 * 1000 // 24 hours default
    this.maxMemoryMb = config.maxMemoryMb ?? 50 // 50MB default
  }

  get size(): number {
    return this.cache.size
  }

  get evictionCount(): number {
    return this.evictions
  }

  set(key: string, messages: Message[]): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      value: messages,
      timestamp: Date.now(),
      hits: 0,
    })
    this.updateAccessOrder(key)
  }

  get(key: string): Message[] | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key)
      return undefined
    }

    // Update hit count and access order
    entry.hits++
    this.updateAccessOrder(key)
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
    this.accessOrder = this.accessOrder.filter(k => k !== key)
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder = []
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

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key)
        this.accessOrder = this.accessOrder.filter(k => k !== key)
        pruned++
      }
    }

    return pruned
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return

    const lruKey = this.accessOrder.shift()!
    this.cache.delete(lruKey)
    this.evictions++
  }

  private updateAccessOrder(key: string): void {
    this.accessOrder = this.accessOrder.filter(k => k !== key)
    this.accessOrder.push(key)
  }
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_calls?: unknown[]
  tool_use_id?: string
}

export type CacheMessage = Message

export function createConversationCache(
  config?: ConversationCacheConfig,
): ConversationCache {
  return new ConversationCache(config)
}
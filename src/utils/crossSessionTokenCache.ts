/**
 * Cross-Session Token Cache - Reusable token context across sessions
 * 
 * Stores tokenized content that can be shared across sessions
 * to avoid re-processing common content.
 */

import { createHash } from 'crypto'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'

export interface CrossSessionCacheEntry {
  contentHash: string
  contentPreview: string
  tokenCount: number
  lastUsed: number
  useCount: number
}

export interface CrossSessionCacheStats {
  size: number
  totalUses: number
  reusedEntries: number
  reuseRate: number
}

export class CrossSessionTokenCache {
  private cache = new Map<string, CrossSessionCacheEntry>()
  private readonly maxEntries: number
  private readonly maxAge: number

  constructor(maxEntries = 100, maxAgeMs = 24 * 60 * 60 * 1000) {
    this.maxEntries = maxEntries
    this.maxAge = maxAgeMs
  }

  /**
   * Get or create cache entry for content
   */
  getOrCreate(content: string): CrossSessionCacheEntry {
    const hash = this.hashContent(content)
    const existing = this.cache.get(hash)
    if (existing) {
      existing.lastUsed = Date.now()
      existing.useCount++
      return existing
    }

    const entry: CrossSessionCacheEntry = {
      contentHash: hash,
      contentPreview: content.slice(0, 50),
      tokenCount: roughTokenCountEstimation(content),
      lastUsed: Date.now(),
      useCount: 1,
    }

    this.cache.set(hash, entry)
    this.prune()
    return entry
  }

  /**
   * Get token count from cache (without re-computing)
   */
  getTokenCount(content: string): number {
    return this.getOrCreate(content).tokenCount
  }

  /**
   * Check if content is cached
   */
  has(content: string): boolean {
    return this.cache.has(this.hashContent(content))
  }

  /**
   * Estimate with bounds (cross-session aware)
   */
  estimateWithBounds(content: string): {
    estimate: number
    min: number
    max: number
    cached: boolean
  } {
    const entry = this.getOrCreate(content)
    return {
      estimate: entry.tokenCount,
      min: Math.round(entry.tokenCount * 0.8),
      max: Math.round(entry.tokenCount * 1.2),
      cached: entry.useCount > 1,
    }
  }

  /**
   * Prune expired and overflow entries
   */
  prune(): void {
    const now = Date.now()
    const toDelete: string[] = []
    
    for (const [hash, entry] of this.cache) {
      if (now - entry.lastUsed > this.maxAge) {
        toDelete.push(hash)
      }
    }
    
    for (const hash of toDelete) {
      this.cache.delete(hash)
    }

    while (this.cache.size > this.maxEntries) {
      let oldest: string | null = null
      let oldestTime = Infinity
      
      for (const [hash, entry] of this.cache) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed
          oldest = hash
        }
      }
      
      if (oldest) {
        this.cache.delete(oldest)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CrossSessionCacheStats {
    let totalUses = 0
    let reused = 0
    
    for (const entry of this.cache.values()) {
      totalUses += entry.useCount
      if (entry.useCount > 1) reused++
    }

    return {
      size: this.cache.size,
      totalUses,
      reusedEntries: reused,
      reuseRate: this.cache.size > 0 ? (reused / this.cache.size) * 100 : 0,
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear()
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content.slice(0, 1024)).digest('hex').slice(0, 16)
  }
}
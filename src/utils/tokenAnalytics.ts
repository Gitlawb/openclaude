/**
 * Token Analytics - Historical token usage tracking and analysis
 * 
 * Tracks token usage patterns over time for cost optimization
 * and capacity planning.
 */

import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export interface TokenUsageEntry {
  timestamp: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  model: string
}

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
    const modelCounts = new Map<string, number>()
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
   * Get entries for a specific model
   */
  getByModel(model: string): TokenUsageEntry[] {
    return this.history.filter(e => e.model === model)
  }

  /**
   * Calculate cost estimate (approximate)
   */
  estimateCost(): { input: number; output: number; cache: number } {
    const analytics = this.getAnalytics()
    
    // Approximate pricing (adjust as needed)
    const inputCost = analytics.totalInputTokens * 0.00015
    const outputCost = analytics.totalOutputTokens * 0.0006
    const cacheCost = analytics.totalCacheRead * 0.000075
    
    return {
      input: Math.round(inputCost * 100) / 100,
      output: Math.round(outputCost * 100) / 100,
      cache: Math.round(cacheCost * 100) / 100,
    }
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

  /**
   * Export history as JSON
   */
  export(): string {
    return JSON.stringify(this.history, null, 2)
  }

  /**
   * Import history from JSON
   */
  import(json: string): void {
    try {
      const entries = JSON.parse(json) as TokenUsageEntry[]
      this.history = entries.slice(-this.maxEntries)
    } catch {
      // Invalid JSON, ignore
    }
  }
}
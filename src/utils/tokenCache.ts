/**
 * Token Cache Utilities - Production Grade
 * 
 * Comprehensive cache token tracking, breakdown, and analytics.
 */

import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export interface TokenCacheInfo {
  cacheRead: number
  cacheCreation: number
  total: number
}

export interface TokenBreakdown {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  cacheEfficiency: number
  newTokens: number
}

export interface TokenAnalytics {
  breakdown: TokenBreakdown
  cacheRatio: number
  costEstimate: CostEstimate
  efficiency: 'low' | 'medium' | 'high'
}

export interface CostEstimate {
  input: number
  output: number
  cache: number
  total: number
  currency: string
}

export interface CacheMetrics {
  totalCacheTokens: number
  cacheHitRate: number
  cacheCreationRate: number
  efficiency: number
}

/**
 * Pricing constants (approximate, can be configured)
 */
const DEFAULT_PRICING = {
  inputPer1M: 0.15,    // $0.15 per 1M input tokens
  outputPer1M: 0.60,   // $0.60 per 1M output tokens  
  cacheReadPer1M: 0.075, // $0.075 per 1M cached tokens
  cacheCreationPer1M: 0.10, // $0.10 per 1M cache creation
  currency: 'USD',
}

/**
 * Extract cache token information from usage data.
 */
export function getCacheTokens(usage: Usage): TokenCacheInfo {
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  
  return {
    cacheRead,
    cacheCreation,
    total: cacheRead + cacheCreation,
  }
}

/**
 * Calculate new (non-cached) tokens.
 */
export function getNewTokensOnly(usage: Usage): number {
  return usage.input_tokens + usage.output_tokens
}

/**
 * Get comprehensive token breakdown with all metrics.
 */
export function getTokenBreakdown(usage: Usage): TokenBreakdown {
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  const input = usage.input_tokens
  const output = usage.output_tokens
  
  const newTokens = input + output
  const total = newTokens + cacheRead + cacheCreation
  const cacheEfficiency = total > 0 ? (cacheRead / total) * 100 : 0

  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    total,
    cacheEfficiency: Math.round(cacheEfficiency * 10) / 10,
    newTokens,
  }
}

/**
 * Calculate cost estimate based on token usage.
 */
export function estimateCost(
  usage: Usage,
  pricing = DEFAULT_PRICING,
): CostEstimate {
  const breakdown = getTokenBreakdown(usage)
  
  const inputCost = (breakdown.input / 1_000_000) * pricing.inputPer1M
  const outputCost = (breakdown.output / 1_000_000) * pricing.outputPer1M
  const cacheReadCost = (breakdown.cacheRead / 1_000_000) * pricing.cacheReadPer1M
  const cacheCreationCost = (breakdown.cacheCreation / 1_000_000) * pricing.cacheCreationPer1M
  
  return {
    input: Math.round(inputCost * 1000) / 1000,
    output: Math.round(outputCost * 1000) / 1000,
    cache: Math.round((cacheReadCost + cacheCreationCost) * 1000) / 1000,
    total: Math.round((inputCost + outputCost + cacheReadCost + cacheCreationCost) * 1000) / 1000,
    currency: pricing.currency,
  }
}

/**
 * Get comprehensive analytics with all metrics.
 */
export function getTokenAnalytics(usage: Usage): TokenAnalytics {
  const breakdown = getTokenBreakdown(usage)
  const costEstimate = estimateCost(usage)
  
  // Determine efficiency level
  let efficiency: 'low' | 'medium' | 'high' = 'low'
  if (breakdown.cacheEfficiency > 30) {
    efficiency = 'high'
  } else if (breakdown.cacheEfficiency > 10) {
    efficiency = 'medium'
  }

  return {
    breakdown,
    cacheRatio: breakdown.cacheEfficiency,
    costEstimate,
    efficiency,
  }
}

/**
 * Calculate cache metrics for a batch of usages.
 */
export function getCacheMetrics(usages: Usage[]): CacheMetrics {
  if (usages.length === 0) {
    return {
      totalCacheTokens: 0,
      cacheHitRate: 0,
      cacheCreationRate: 0,
      efficiency: 0,
    }
  }

  let totalCacheRead = 0
  let totalCacheCreation = 0
  let totalTokens = 0

  for (const usage of usages) {
    const breakdown = getTokenBreakdown(usage)
    totalCacheRead += breakdown.cacheRead
    totalCacheCreation += breakdown.cacheCreation
    totalTokens += breakdown.total
  }

  return {
    totalCacheTokens: totalCacheRead + totalCacheCreation,
    cacheHitRate: totalTokens > 0 
      ? Math.round((totalCacheRead / totalTokens) * 1000) / 10 
      : 0,
    cacheCreationRate: totalTokens > 0 
      ? Math.round((totalCacheCreation / totalTokens) * 1000) / 10 
      : 0,
    efficiency: totalTokens > 0 
      ? Math.round(((totalCacheRead + totalCacheCreation) / totalTokens) * 1000) / 10 
      : 0,
  }
}

/**
 * Format tokens for display.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toString()
}

/**
 * Format cost for display.
 */
export function formatCost(cost: CostEstimate): string {
  return `$${cost.total.toFixed(4)} ($${cost.input} in, $${cost.output} out, $${cost.cache} cache)`
}

/**
 * Compare two token usages.
 */
export function compareUsages(
  before: Usage,
  after: Usage,
): {
  inputDelta: number
  outputDelta: number
  cacheDelta: number
  costDelta: number
  percentChange: number
} {
  const beforeCost = estimateCost(before)
  const afterCost = estimateCost(after)
  
  const beforeTotal = before.input_tokens + before.output_tokens
  const afterTotal = after.input_tokens + after.output_tokens
  
  return {
    inputDelta: after.input_tokens - before.input_tokens,
    outputDelta: after.output_tokens - before.output_tokens,
    cacheDelta: (after.cache_read_input_tokens ?? 0) - (before.cache_read_input_tokens ?? 0),
    costDelta: afterCost.total - beforeCost.total,
    percentChange: beforeTotal > 0 
      ? Math.round(((afterTotal - beforeTotal) / beforeTotal) * 100) 
      : 0,
  }
}

/**
 * Check if usage exceeds budget.
 */
export function exceedsBudget(
  usage: Usage,
  budget: { maxTokens?: number; maxCost?: number },
): { overTokens: boolean; overCost: boolean; details?: string } {
  const total = usage.input_tokens + usage.output_tokens
  const breakdown = getTokenBreakdown(usage)
  
  const overTokens = budget.maxTokens !== undefined && total > budget.maxTokens
  const costEstimate = estimateCost(usage)
  const overCost = budget.maxCost !== undefined && costEstimate.total > budget.maxCost
  
  let details: string | undefined
  if (overTokens && overCost) {
    details = `Over budget: ${formatTokens(total)} tokens (max ${formatTokens(budget.maxTokens!)}) and $${costEstimate.total} cost (max $${budget.maxCost})`
  } else if (overTokens) {
    details = `Over token budget: ${formatTokens(total)} tokens (max ${formatTokens(budget.maxTokens!)})`
  } else if (overCost) {
    details = `Over cost budget: $${costEstimate.total} (max $${budget.maxCost})`
  }
  
  return { overTokens, overCost, details }
}

/**
 * Predict token usage based on content.
 */
export function predictTokens(
  content: string,
  model: string,
): { estimated: number; confidence: 'low' | 'medium' | 'high' } {
  // Base estimation
  const baseEstimate = Math.round(content.length / 4)
  
  // Adjust based on model family
  let multiplier = 1.0
  const modelLower = model.toLowerCase()
  
  if (modelLower.includes('claude')) {
    multiplier = 0.85 // Claude is more token-efficient
  } else if (modelLower.includes('gpt-4')) {
    multiplier = 1.0
  } else if (modelLower.includes('gpt-3.5')) {
    multiplier = 1.1
  } else if (modelLower.includes('gemini')) {
    multiplier = 0.9
  }
  
  // Content type adjustments
  if (content.includes('{') && content.includes('}')) {
    multiplier *= 0.7 // JSON is more compact
  } else if (/^\s*[\-\*\d]/.test(content)) {
    multiplier *= 0.8 // Lists are compact
  }
  
  const estimated = Math.round(baseEstimate * multiplier)
  
  // Confidence based on content type
  let confidence: 'low' | 'medium' | 'high' = 'medium'
  if (content.length < 100) {
    confidence = 'low' // Short content has higher variance
  } else if (content.length > 1000 && content.includes(' ')) {
    confidence = 'high' // Longer prose is more predictable
  }
  
  return { estimated, confidence }
}
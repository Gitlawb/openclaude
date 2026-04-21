import { describe, expect, it } from 'bun:test'
import {
  getCacheTokens,
  getNewTokensOnly,
  getTokenBreakdown,
  estimateCost,
  getTokenAnalytics,
  getCacheMetrics,
  formatTokens,
  formatCost,
  compareUsages,
  exceedsBudget,
  predictTokens,
} from './tokenCache.js'

interface FakeUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

const createFakeUsage = (overrides: Partial<FakeUsage> = {}): FakeUsage => ({
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_input_tokens: 200,
  cache_creation_input_tokens: 100,
  ...overrides,
})

describe('tokenCache', () => {
  describe('getCacheTokens', () => {
    it('extracts cache read and creation', () => {
      const usage = createFakeUsage()
      const result = getCacheTokens(usage as any)
      expect(result.cacheRead).toBe(200)
      expect(result.cacheCreation).toBe(100)
      expect(result.total).toBe(300)
    })

    it('handles missing cache tokens', () => {
      const usage = { input_tokens: 1000, output_tokens: 500 }
      const result = getCacheTokens(usage as any)
      expect(result.cacheRead).toBe(0)
      expect(result.cacheCreation).toBe(0)
    })
  })

  describe('getNewTokensOnly', () => {
    it('excludes cache tokens', () => {
      const usage = createFakeUsage()
      expect(getNewTokensOnly(usage as any)).toBe(1500)
    })
  })

  describe('getTokenBreakdown', () => {
    it('returns full breakdown', () => {
      const usage = createFakeUsage()
      const result = getTokenBreakdown(usage as any)

      expect(result.input).toBe(1000)
      expect(result.output).toBe(500)
      expect(result.cacheRead).toBe(200)
      expect(result.cacheCreation).toBe(100)
      expect(result.total).toBe(1800)
      expect(result.newTokens).toBe(1500)
    })

    it('calculates cache efficiency', () => {
      const usage = createFakeUsage()
      const result = getTokenBreakdown(usage as any)
      expect(result.cacheEfficiency).toBeGreaterThan(0)
    })
  })

  describe('estimateCost', () => {
    it('calculates cost with default pricing', () => {
      const usage = createFakeUsage({ input_tokens: 1_000_000, output_tokens: 500_000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 50_000 })
      const cost = estimateCost(usage as any)

      expect(cost.input).toBeGreaterThan(0)
      expect(cost.output).toBeGreaterThan(0)
      expect(cost.cache).toBeGreaterThanOrEqual(0)
      expect(cost.total).toBeGreaterThan(0)
      expect(cost.currency).toBe('USD')
    })

    it('accepts custom pricing', () => {
      const usage = createFakeUsage()
      const customPricing = {
        inputPer1M: 0.10,
        outputPer1M: 0.50,
        cacheReadPer1M: 0.05,
        cacheCreationPer1M: 0.08,
        currency: 'USD',
      }
      const cost = estimateCost(usage as any, customPricing)
      expect(cost.input).toBeLessThan(0.5)
    })
  })

  describe('getTokenAnalytics', () => {
    it('returns full analytics', () => {
      const usage = createFakeUsage()
      const analytics = getTokenAnalytics(usage as any)

      expect(analytics.breakdown).toBeDefined()
      expect(analytics.cacheRatio).toBeGreaterThan(0)
      expect(analytics.costEstimate).toBeDefined()
      expect(['low', 'medium', 'high']).toContain(analytics.efficiency)
    })

    it('determines high efficiency', () => {
      const usage = createFakeUsage({
        input_tokens: 500,
        output_tokens: 200,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 100,
      })
      const analytics = getTokenAnalytics(usage as any)
      expect(analytics.efficiency).toBe('high')
    })

    it('determines low efficiency', () => {
      const usage = createFakeUsage({
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      })
      const analytics = getTokenAnalytics(usage as any)
      expect(analytics.efficiency).toBe('low')
    })
  })

  describe('getCacheMetrics', () => {
    it('returns zero for empty array', () => {
      const metrics = getCacheMetrics([])
      expect(metrics.totalCacheTokens).toBe(0)
      expect(metrics.cacheHitRate).toBe(0)
      expect(metrics.cacheCreationRate).toBe(0)
      expect(metrics.efficiency).toBe(0)
    })

    it('calculates metrics for batch', () => {
      const usages = [createFakeUsage(), createFakeUsage()]
      const metrics = getCacheMetrics(usages as any)

      expect(metrics.totalCacheTokens).toBeGreaterThan(0)
      expect(metrics.cacheHitRate).toBeGreaterThan(0)
    })
  })

  describe('formatTokens', () => {
    it('formats thousands', () => {
      expect(formatTokens(1500)).toBe('1.5K')
    })

    it('formats millions', () => {
      expect(formatTokens(1500000)).toBe('1.5M')
    })

    it('formats small numbers', () => {
      expect(formatTokens(500)).toBe('500')
    })
  })

  describe('formatCost', () => {
    it('formats cost with details', () => {
      const cost = {
        input: 0.001,
        output: 0.002,
        cache: 0.001,
        total: 0.004,
        currency: 'USD',
      }
      const formatted = formatCost(cost)
      expect(formatted).toContain('$')
    })
  })

  describe('compareUsages', () => {
    it('calculates deltas between usages', () => {
      const before = createFakeUsage({ input_tokens: 800, output_tokens: 400 })
      const after = createFakeUsage({ input_tokens: 1000, output_tokens: 500 })

      const comparison = compareUsages(before as any, after as any)

      expect(comparison.inputDelta).toBe(200)
      expect(comparison.outputDelta).toBe(100)
      expect(comparison.cacheDelta).toBe(0)
      expect(comparison.percentChange).toBeDefined()
    })
  })

  describe('exceedsBudget', () => {
    it('detects token budget exceed', () => {
      const usage = createFakeUsage({ input_tokens: 2000, output_tokens: 1000 })
      const result = exceedsBudget(usage as any, { maxTokens: 2000 })

      expect(result.overTokens).toBe(true)
      expect(result.details).toBeDefined()
    })

    it('detects cost budget exceed', () => {
      const usage = createFakeUsage({ input_tokens: 1_000_000, output_tokens: 500_000 })
      const result = exceedsBudget(usage as any, { maxCost: 0.001 })

      expect(result.overCost).toBe(true)
      expect(result.details).toBeDefined()
    })

    it('returns false when under budget', () => {
      const usage = createFakeUsage({ input_tokens: 100, output_tokens: 50 })
      const result = exceedsBudget(usage as any, { maxTokens: 10000, maxCost: 1.0 })

      expect(result.overTokens).toBe(false)
      expect(result.overCost).toBe(false)
    })
  })

  describe('predictTokens', () => {
    it('estimates basic content', () => {
      const result = predictTokens('Hello world this is a test', 'claude-3')
      expect(result.estimated).toBeGreaterThan(0)
    })

    it('adjusts for Claude model', () => {
      const result = predictTokens('test content', 'claude-3')
      expect(result.estimated).toBeLessThan(20)
    })

    it('adjusts for GPT model', () => {
      const result = predictTokens('test content', 'gpt-4')
      expect(result.estimated).toBeLessThan(20)
    })

    it('adjusts for JSON content', () => {
      const result = predictTokens('{"key": "value"}', 'claude-3')
      expect(result.estimated).toBeLessThan(20)
    })

    it('adjusts for list content', () => {
      const result = predictTokens('- item 1\n- item 2\n- item 3', 'claude-3')
      expect(result.estimated).toBeLessThan(30)
    })

    it('determines confidence levels', () => {
      const lowConfidence = predictTokens('hi', 'claude-3')
      expect(lowConfidence.confidence).toBe('low')

      const highConfidence = predictTokens(
        'This is a longer piece of content that has multiple words and proper spacing for accurate estimation and more words to ensure higher confidence level in the estimation algorithm',
        'claude-3'
      )
      expect(['medium', 'high']).toContain(highConfidence.confidence)
    })
  })
})
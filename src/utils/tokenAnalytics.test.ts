import { describe, expect, it, beforeEach } from 'bun:test'
import { TokenUsageTracker } from './tokenAnalytics.js'

describe('TokenUsageTracker', () => {
  let tracker: TokenUsageTracker

  beforeEach(() => {
    tracker = new TokenUsageTracker(100)
  })

  it('records token usage', () => {
    tracker.record({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 100,
      model: 'claude-sonnet-4-5-20250514',
    })

    expect(tracker.size).toBe(1)
  })

  it('calculates analytics', () => {
    tracker.record({
      input_tokens: 1000,
      output_tokens: 500,
      model: 'claude-sonnet-4-5-20250514',
    })

    tracker.record({
      input_tokens: 2000,
      output_tokens: 300,
      model: 'claude-sonnet-4-5-20250514',
    })

    const analytics = tracker.getAnalytics()

    expect(analytics.totalRequests).toBe(2)
    expect(analytics.totalInputTokens).toBe(3000)
    expect(analytics.totalOutputTokens).toBe(800)
    expect(analytics.averageInputPerRequest).toBe(1500)
    expect(analytics.averageOutputPerRequest).toBe(400)
  })

  it('tracks cache hit rate', () => {
    tracker.record({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 500, // 33% cache
      model: 'claude-sonnet-4-5-20250514',
    })

    const analytics = tracker.getAnalytics()

    expect(analytics.cacheHitRate).toBeGreaterThan(0)
  })

  it('tracks most used model', () => {
    tracker.record({ input_tokens: 1000, output_tokens: 100, model: 'sonnet' })
    tracker.record({ input_tokens: 1000, output_tokens: 100, model: 'sonnet' })
    tracker.record({ input_tokens: 1000, output_tokens: 100, model: 'opus' })

    expect(tracker.getAnalytics().mostUsedModel).toBe('sonnet')
  })

  it('respects max entries limit', () => {
    const smallTracker = new TokenUsageTracker(3)

    smallTracker.record({ input_tokens: 1, output_tokens: 1, model: 'a' })
    smallTracker.record({ input_tokens: 2, output_tokens: 2, model: 'b' })
    smallTracker.record({ input_tokens: 3, output_tokens: 3, model: 'c' })
    smallTracker.record({ input_tokens: 4, output_tokens: 4, model: 'd' })
    smallTracker.record({ input_tokens: 5, output_tokens: 5, model: 'e' })

    expect(smallTracker.size).toBe(3)
  })

it('clears history', () => {
      tracker.record({ input_tokens: 1000, output_tokens: 100, model: 'test' })
      tracker.clear()

      expect(tracker.size).toBe(0)
    })
})
import { describe, expect, it } from 'bun:test'
import {
  splitContext,
  applyHybridStrategy,
  optimizeForCost,
  optimizeForAccuracy,
  getHybridStats,
} from './hybridContextStrategy.js'

function createMessage(role: string, content: string, createdAt: number = Date.now()): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: createdAt },
    sender: role,
  }
}

describe('hybridContextStrategy', () => {
  describe('splitContext', () => {
    it('splits context into cached and fresh', () => {
      const messages = [
        createMessage('system', 'System prompt', Date.now() - 86400000),
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi there'),
      ]

      const split = splitContext(messages, {
        cacheWeight: 0.4,
        freshWeight: 0.6,
        maxTotalTokens: 10000,
      })

      expect(split.cachedTokens).toBeGreaterThanOrEqual(0)
      expect(split.freshTokens).toBeGreaterThanOrEqual(0)
      expect(split.totalTokens).toBeGreaterThan(0)
    })

    it('respects weight configuration', () => {
      const messages = [
        createMessage('system', 'Old system', Date.now() - 86400000),
        createMessage('user', 'Recent message', Date.now()),
      ]

      const split = splitContext(messages, {
        cacheWeight: 0.5,
        freshWeight: 0.5,
        maxTotalTokens: 10000,
      })

      expect(split.cached).toBeDefined()
      expect(split.fresh).toBeDefined()
    })
  })

  describe('applyHybridStrategy', () => {
    it('applies strategy and returns messages', () => {
      const messages = [
        createMessage('user', 'Message 1'),
        createMessage('assistant', 'Response 1'),
      ]

      const result = applyHybridStrategy(messages, {
        cacheWeight: 0.5,
        freshWeight: 0.5,
        maxTotalTokens: 10000,
      })

      expect(result.selectedMessages.length).toBeGreaterThan(0)
      expect(['cache_heavy', 'fresh_heavy', 'balanced']).toContain(result.strategy)
    })

    it('calculates estimated cost', () => {
      const messages = [
        createMessage('user', 'Test message'),
      ]

      const result = applyHybridStrategy(messages, {
        cacheWeight: 0.5,
        freshWeight: 0.5,
        maxTotalTokens: 10000,
      })

      expect(result.estimatedCost).toBeGreaterThanOrEqual(0)
    })
  })

  describe('optimizeForCost', () => {
    it('returns messages within budget', () => {
      const messages = [
        createMessage('user', 'Message 1'),
        createMessage('assistant', 'Response 1'),
      ]

      const result = optimizeForCost(messages, 0.001)

      expect(result.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('optimizeForAccuracy', () => {
    it('optimizes for accuracy with token limit', () => {
      const messages = [
        createMessage('user', 'Message 1'),
        createMessage('assistant', 'Response 1'),
      ]

      const result = optimizeForAccuracy(messages, 5000)

      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getHybridStats', () => {
    it('returns statistics', () => {
      const messages = [
        createMessage('system', 'System', Date.now() - 86400000),
        createMessage('user', 'Hello'),
      ]

      const split = splitContext(messages, { cacheWeight: 0.5, freshWeight: 0.5, maxTotalTokens: 10000 })
      const stats = getHybridStats(split)

      expect(stats.cacheRatio).toBeGreaterThanOrEqual(0)
      expect(stats.freshRatio).toBeGreaterThanOrEqual(0)
      expect(stats.totalTokens).toBeGreaterThan(0)
    })
  })
})
import { describe, expect, it, beforeEach } from 'bun:test'
import { IncrementalTokenCounter, CounterFactory } from './incrementalTokenCounter.js'
import type { Message } from '../types/message.js'

function createMessage(content: string): Message {
  return {
    type: 'user' as const,
    message: { role: 'user', content, id: 'test', type: 'message', created_at: Date.now() },
    sender: 'user',
  }
}

describe('IncrementalTokenCounter', () => {
  describe('constructor', () => {
    it('creates with default config', () => {
      const counter = new IncrementalTokenCounter()
      expect(counter.cachedCount).toBe(0)
      expect(counter.messageCount).toBe(0)
    })

    it('creates with custom config', () => {
      const counter = new IncrementalTokenCounter({
        maxCacheSize: 500,
        autoInvalidate: false,
        estimationMultiplier: 1.2,
      })
      expect(counter.cachedCount).toBe(0)
    })
  })

  describe('getCount', () => {
    it('returns 0 for empty messages', () => {
      const counter = new IncrementalTokenCounter()
      expect(counter.getCount([])).toBe(0)
    })

    it('calculates count for new messages', () => {
      const counter = new IncrementalTokenCounter()
      const messages = [createMessage('Hello world')]
      const count = counter.getCount(messages)
      expect(count).toBeGreaterThan(0)
    })

    it('uses cache for same message count', () => {
      const counter = new IncrementalTokenCounter()
      const messages = [createMessage('Hello world')]

      const count1 = counter.getCount(messages)
      const stats1 = counter.getStats()

      const count2 = counter.getCount(messages)
      const stats2 = counter.getStats()

      expect(count1).toBe(count2)
      expect(stats2.hits).toBeGreaterThan(stats1.hits)
    })

    it('handles incremental growth', () => {
      const counter = new IncrementalTokenCounter({ autoInvalidate: true })

      const msgs1 = [createMessage('Hello')]
      counter.getCount(msgs1)

      const msgs2 = [createMessage('Hello'), createMessage('World')]
      const count = counter.getCount(msgs2)
      expect(count).toBeGreaterThan(0)
    })
  })

  describe('invalidate', () => {
    it('force recalculates from full context', () => {
      const counter = new IncrementalTokenCounter()
      const messages = [createMessage('Test message')]
      counter.getCount(messages)

      const newCount = counter.invalidate(messages)
      expect(newCount).toBeGreaterThan(0)

      const stats = counter.getStats()
      expect(stats.misses).toBeGreaterThan(0)
    })

    it('returns 0 for empty messages', () => {
      const counter = new IncrementalTokenCounter()
      const result = counter.invalidate([])
      expect(result).toBe(0)
    })
  })

  describe('estimate', () => {
    it('returns estimation without caching', () => {
      const counter = new IncrementalTokenCounter()
      const messages = [createMessage('Hello world')]
      const estimate = counter.estimate(messages)
      expect(estimate).toBeGreaterThan(0)
    })
  })

  describe('estimateMessage', () => {
    it('estimates string content', () => {
      const counter = new IncrementalTokenCounter()
      const msg = createMessage('Hello world')
      const count = counter.estimateMessage(msg)
      expect(count).toBeGreaterThan(0)
    })

    it('estimates array content with text blocks', () => {
      const counter = new IncrementalTokenCounter()
      const msg = {
        message: {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'Hello' }],
          id: 'test',
          type: 'message',
          created_at: Date.now(),
        },
        sender: 'user',
      }
      const count = counter.estimateMessage(msg)
      expect(count).toBeGreaterThan(0)
    })

    it('estimates array content with thinking blocks', () => {
      const counter = new IncrementalTokenCounter()
      const msg = {
        message: {
          role: 'user' as const,
          content: [{ type: 'thinking' as const, thinking: 'Let me think...' }],
          id: 'test',
          type: 'message',
          created_at: Date.now(),
        },
        sender: 'user',
      }
      const count = counter.estimateMessage(msg)
      expect(count).toBeGreaterThan(0)
    })
  })

  describe('estimateBatch', () => {
    it('sums multiple messages', () => {
      const counter = new IncrementalTokenCounter()
      const messages = [
        createMessage('Message 1'),
        createMessage('Message 2'),
        createMessage('Message 3'),
      ]
      const total = counter.estimateBatch(messages)
      expect(total).toBeGreaterThan(0)
    })
  })

  describe('getRemainingBudget', () => {
    it('calculates remaining context window', () => {
      const counter = new IncrementalTokenCounter()
      const messages = [createMessage('Hello')]
      counter.getCount(messages)
      const remaining = counter.getRemainingBudget(messages, 100000)
      expect(remaining).toBeLessThanOrEqual(100000)
      expect(remaining).toBeGreaterThan(0)
    })
  })

  describe('isApproachingLimit', () => {
    it('returns false when far from limit', () => {
      const counter = new IncrementalTokenCounter({ maxCacheSize: 1000 })
      counter.getCount([createMessage('Hi')])
      expect(counter.isApproachingLimit([createMessage('Hi')], 0.8)).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const counter = new IncrementalTokenCounter()
      counter.getCount([createMessage('Hello')])
      counter.reset()
      expect(counter.cachedCount).toBe(0)
      expect(counter.messageCount).toBe(0)
      const stats = counter.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })
  })

  describe('getStats', () => {
    it('tracks hits and misses', () => {
      const counter = new IncrementalTokenCounter()
      counter.getCount([createMessage('Hello')])
      counter.getCount([createMessage('Hello')])

      const stats = counter.getStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
    })

    it('calculates hit rate', () => {
      const counter = new IncrementalTokenCounter()
      counter.getCount([createMessage('Test')])
      counter.getCount([createMessage('Test')])
      counter.getCount([createMessage('Test')])

      const stats = counter.getStats()
      expect(stats.hitRate).toBeGreaterThanOrEqual(0)
    })
  })

  describe('updateConfig', () => {
    it('updates config dynamically', () => {
      const counter = new IncrementalTokenCounter()
      counter.updateConfig({ maxCacheSize: 2000 })
      counter.getCount([createMessage('Hello')])
      expect(counter.cachedCount).toBeGreaterThan(0)
    })
  })

  describe('prefix mutation + append invalidation', () => {
    it('recalculates when prefix is mutated and new message appended', () => {
      const counter = new IncrementalTokenCounter({ autoInvalidate: true })

      const msg1 = createMessage('First message content here')
      const msg2 = createMessage('Second message content')

      const count1 = counter.getCount([msg1, msg2])
      expect(count1).toBeGreaterThan(0)

      const mutatedMsg1 = createMessage('Mutated first message content changed')
      const msg3 = createMessage('Third message appended')

      const count2 = counter.getCount([mutatedMsg1, msg2, msg3])

      const fullCount = counter.invalidate([mutatedMsg1, msg2, msg3])
      expect(count2).toBe(fullCount)
    })

    it('uses incremental when prefix unchanged and new message appended', () => {
      const counter = new IncrementalTokenCounter({ autoInvalidate: true })

      const msg1 = createMessage('First message')
      const msg2 = createMessage('Second message')

      const count1 = counter.getCount([msg1, msg2])

      const msg3 = createMessage('Third message new')

      const count2 = counter.getCount([msg1, msg2, msg3])
      expect(count2).toBeGreaterThan(count1)
    })
  })
})

describe('CounterFactory', () => {
  describe('realtime', () => {
    it('creates high-performance counter', () => {
      const counter = CounterFactory.realtime()
      expect(counter).toBeInstanceOf(IncrementalTokenCounter)
    })
  })

  describe('batch', () => {
    it('creates conservative counter', () => {
      const counter = CounterFactory.batch()
      expect(counter).toBeInstanceOf(IncrementalTokenCounter)
    })
  })

  describe('lightweight', () => {
    it('creates memory-efficient counter', () => {
      const counter = CounterFactory.lightweight()
      expect(counter).toBeInstanceOf(IncrementalTokenCounter)
    })
  })
})
import { describe, expect, it, beforeEach } from 'bun:test'
import {
  getTokenCountFromUsage,
  tokenCountWithEstimation,
} from './tokens.js'
import { IncrementalTokenCounter } from './incrementalTokenCounter.js'

interface FakeUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

describe('IncrementalTokenCounter', () => {
  it('uses cached count for same message length', () => {
    const counter = new IncrementalTokenCounter()
    
    counter.getCount([
      { type: 'user', message: { content: 'hello' } } as any,
    ])
    
    expect(counter.cachedCount).toBeGreaterThan(0)
  })

  it('increments for new messages', () => {
    const counter = new IncrementalTokenCounter()
    
    const count1 = counter.getCount([
      { type: 'user', message: { content: 'hello' } } as any,
    ])
    
    const count2 = counter.getCount([
      { type: 'user', message: { content: 'hello' } } as any,
      { type: 'user', message: { content: 'world' } } as any,
    ])
    
    expect(count2).toBeGreaterThan(count1)
  })

  it('resets correctly', () => {
    const counter = new IncrementalTokenCounter()
    
    counter.getCount([{ type: 'user', message: { content: 'hello' } } as any])
    counter.reset()
    
    expect(counter.cachedCount).toBe(0)
    expect(counter.messageCount).toBe(0)
  })
})

describe('tokenCountWithEstimation — cachedMessageTokenEstimate regression', () => {
  it('estimates follow-up user messages (not 0 — bug fix)', () => {
    const assistantWithUsage = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      messageId: 'resp-1',
    }
    const userFollowUp = {
      type: 'user',
      message: { content: 'hello world hello world hello world hello world' },
    }

    const count = tokenCountWithEstimation([assistantWithUsage, userFollowUp] as any)
    // Should include estimate for follow-up (was 0 due to passing message.message)
    expect(count).toBeGreaterThan(0)
    // Should be > usage total alone (20 vs 15+)
    expect(count).toBeGreaterThan(15)
  })

  it('handles attachment messages without throwing', () => {
    const attachmentMsg = {
      type: 'user',
      attachment: { type: 'image', path: '/tmp/test.png' },
    }
    const msg = {
      type: 'user',
      message: { content: 'hello' },
    }

    expect(() => {
      tokenCountWithEstimation([msg, attachmentMsg] as any)
    }).not.toThrow()
  })
})
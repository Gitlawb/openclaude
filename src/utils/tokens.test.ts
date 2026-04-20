import { describe, expect, it, beforeEach } from 'bun:test'
import {
  getTokenCountFromUsage,
  getCacheTokens,
  getNewTokensOnly,
  getTokenBreakdown,
  IncrementalTokenCounter,
} from './tokens.js'

interface FakeUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

describe('tokens', () => {
  describe('getTokenCountFromUsage', () => {
    it('calculates total including cache tokens', () => {
      const usage: FakeUsage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      }
      expect(getTokenCountFromUsage(usage as any)).toBe(1800)
    })

    it('handles missing cache tokens as zero', () => {
      const usage: FakeUsage = {
        input_tokens: 1000,
        output_tokens: 500,
      }
      expect(getTokenCountFromUsage(usage as any)).toBe(1500)
    })
  })

  describe('getCacheTokens', () => {
    it('extracts cache read and creation separately', () => {
      const usage: FakeUsage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      }
      expect(getCacheTokens(usage as any)).toEqual({ cacheRead: 200, cacheCreation: 100 })
    })

    it('handles missing cache tokens', () => {
      const usage: FakeUsage = {
        input_tokens: 1000,
        output_tokens: 500,
      }
      expect(getCacheTokens(usage as any)).toEqual({ cacheRead: 0, cacheCreation: 0 })
    })
  })

  describe('getNewTokensOnly', () => {
    it('excludes cache tokens from count', () => {
      const usage: FakeUsage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      }
      expect(getNewTokensOnly(usage as any)).toBe(1500)
    })
  })

  describe('getTokenBreakdown', () => {
    it('returns full breakdown with efficiency', () => {
      const usage: FakeUsage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 100,
      }
      const result = getTokenBreakdown(usage as any)
      
      expect(result.input).toBe(1000)
      expect(result.output).toBe(500)
      expect(result.cacheRead).toBe(300)
      expect(result.cacheCreation).toBe(100)
      expect(result.total).toBe(1900)
      expect(result.cacheEfficiency).toBe(16) // 300/1900 * 100 ≈ 15.79 → 16
    })

    it('handles zero total gracefully', () => {
      const usage: FakeUsage = {
        input_tokens: 0,
        output_tokens: 0,
      }
      expect(getTokenBreakdown(usage as any).cacheEfficiency).toBe(0)
    })
  })
})

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
    expect(counter.cachedMessageCount).toBe(0)
  })
})
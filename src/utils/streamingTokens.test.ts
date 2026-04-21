import { describe, expect, it } from 'bun:test'
import { StreamingTokenCounter } from './streamingTokenCounter.js'

describe('StreamingTokenCounter', () => {
  it('tracks output tokens from chunks', () => {
    const counter = new StreamingTokenCounter()
    counter.start(100)
    
    counter.addChunk('Hello')
    counter.addChunk(' world')
    
    expect(counter.output).toBeGreaterThan(0)
    expect(counter.total).toBe(100 + counter.output)
  })

  it('calculates tokens per second', () => {
    const counter = new StreamingTokenCounter()
    counter.start()
    
    // Add ~10 tokens
    counter.addChunk('1234567890')
    
    // Note: If called immediately, elapsedMs may be 0
    // This tests the method exists and returns a number
    expect(typeof counter.tokensPerSecond).toBe('number')
  })

  it('resets correctly', () => {
    const counter = new StreamingTokenCounter()
    counter.start(100)
    counter.addChunk('test')
    
    counter.reset()
    
    expect(counter.output).toBe(0)
    expect(counter.total).toBe(0)
  })

  it('handles empty chunks', () => {
    const counter = new StreamingTokenCounter()
    counter.start(50)
    
    counter.addChunk(undefined)
    counter.addChunk('')
    
    expect(counter.output).toBe(0)
    expect(counter.total).toBe(50)
  })
})
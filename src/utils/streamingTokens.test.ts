import { describe, expect, it } from 'bun:test'
import { StreamingTokenCounter } from './streamingTokenCounter.js'

describe('StreamingTokenCounter', () => {
  it('accumulates content from chunks', () => {
    const counter = new StreamingTokenCounter()
    counter.start(100)
    
    counter.addChunk('Hello ')
    counter.addChunk('world ')
    
    expect(counter.characterCount).toBeGreaterThan(0)
  })

  it('counts tokens after finalize', () => {
    const counter = new StreamingTokenCounter()
    counter.start(100)
    
    counter.addChunk('Hello ')
    counter.addChunk('world ')
    counter.finalize()
    
    expect(counter.output).toBeGreaterThan(0)
    expect(counter.total).toBe(100 + counter.output)
  })

  it('calculates tokens per second', () => {
    const counter = new StreamingTokenCounter()
    counter.start()
    
    counter.addChunk('123456789 ')
    
    expect(typeof counter.tokensPerSecond).toBe('number')
  })

  it('resets correctly', () => {
    const counter = new StreamingTokenCounter()
    counter.start(100)
    counter.addChunk('test ')
    counter.reset()
    
    expect(counter.characterCount).toBe(0)
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
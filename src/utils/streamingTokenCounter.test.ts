import { describe, expect, it } from 'bun:test'
import { StreamingTokenCounter } from './streamingTokenCounter.js'

describe('StreamingTokenCounter', () => {
  describe('start', () => {
    it('resets state and sets input tokens', () => {
      const counter = new StreamingTokenCounter()
      counter.start(1000)
      expect(counter.total).toBe(1000)
    })
  })

  describe('addChunk', () => {
    it('accumulates content', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello world ')
      expect(counter.characterCount).toBe(12)
    })

    it('accumulates multiple chunks', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello ')
      counter.addChunk('world ')
      expect(counter.characterCount).toBeGreaterThanOrEqual(10)
    })

    it('handles empty chunks', () => {
      const counter = new StreamingTokenCounter()
      counter.start(50)
      counter.addChunk(undefined)
      counter.addChunk('')
      expect(counter.output).toBe(0)
      expect(counter.total).toBe(50)
    })

    it('updates cached token count at word boundaries during streaming', () => {
      const counter = new StreamingTokenCounter()
      counter.start(100)
      counter.addChunk('Hello ')
      const afterFirst = counter.output
      expect(afterFirst).toBeGreaterThan(0)
      counter.addChunk('world ')
      const afterSecond = counter.output
      expect(afterSecond).toBeGreaterThan(afterFirst)
    })

    it('advances count past space after word boundary', () => {
      const counter = new StreamingTokenCounter()
      counter.start()
      counter.addChunk('Hello ') // counts Hello
      const count1 = counter.output

      counter.addChunk('world') // short chunk, no space - shouldn't advance
      const count2 = counter.output
      expect(count2).toBe(count1)

      counter.addChunk(' ') // space triggers count
      const count3 = counter.output
      expect(count3).toBeGreaterThan(count2)
    })
  })

  describe('finalize', () => {
    it('counts all content after finalize', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello world')
      counter.finalize()
      expect(counter.output).toBeGreaterThan(0)
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
  })

  describe('total', () => {
    it('sums input and output after finalize', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Test content ')
      counter.finalize()
      expect(counter.total).toBeGreaterThanOrEqual(500)
    })
  })

  describe('tokensPerSecond', () => {
    it('calculates tokens per second', () => {
      const counter = new StreamingTokenCounter()
      counter.start()
      counter.addChunk('123456789 ')
      expect(typeof counter.tokensPerSecond).toBe('number')
    })
  })

  describe('estimateRemainingTokens', () => {
    it('returns positive when under target', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello ')
      counter.finalize()
      expect(counter.estimateRemainingTokens(1000)).toBeGreaterThan(0)
    })

    it('returns 0 when at or over target', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello ')
      counter.finalize()
      expect(counter.estimateRemainingTokens(1)).toBe(0)
    })
  })

  describe('estimateRemainingTimeMs', () => {
    it('returns estimate based on rate', () => {
      const counter = new StreamingTokenCounter()
      counter.start()
      counter.addChunk('Hello world ')
      expect(counter.estimateRemainingTimeMs(100)).toBeGreaterThanOrEqual(0)
    })
  })

  describe('characterCount', () => {
    it('returns accumulated character count', () => {
      const counter = new StreamingTokenCounter()
      counter.addChunk('Hello')
      expect(counter.characterCount).toBe(5)
    })

    it('accumulates content from chunks', () => {
      const counter = new StreamingTokenCounter()
      counter.start(100)
      counter.addChunk('Hello ')
      counter.addChunk('world ')
      expect(counter.characterCount).toBeGreaterThan(0)
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello world ')
      counter.reset()
      expect(counter.characterCount).toBe(0)
    })

    it('resets correctly', () => {
      const counter = new StreamingTokenCounter()
      counter.start(100)
      counter.addChunk('test ')
      counter.reset()
      expect(counter.characterCount).toBe(0)
      expect(counter.total).toBe(0)
    })
  })
})
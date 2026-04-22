import { describe, expect, it, beforeEach } from 'bun:test'
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
  })

  describe('finalize', () => {
    it('counts all content after finalize', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello world')
      counter.finalize()
      expect(counter.output).toBeGreaterThan(0)
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
  })

  describe('reset', () => {
    it('clears all state', () => {
      const counter = new StreamingTokenCounter()
      counter.start(500)
      counter.addChunk('Hello world ')
      counter.reset()
      expect(counter.characterCount).toBe(0)
    })
  })
})
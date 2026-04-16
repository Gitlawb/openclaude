import { describe, expect, it, beforeEach } from 'bun:test'
import {
  createStreamState,
  processStreamChunk,
  flushStreamBuffer,
  getStreamStats,
} from './streamingOptimizer.js'

describe('streamingOptimizer', () => {
  let state: ReturnType<typeof createStreamState>

  beforeEach(() => {
    state = createStreamState()
  })

  describe('createStreamState', () => {
    it('creates initial state with zero counts', () => {
      expect(state.chunkCount).toBe(0)
      expect(state.firstTokenTime).toBeNull()
      expect(state.startTime).toBeGreaterThan(0)
    })
  })

  describe('processStreamChunk', () => {
    it('tracks first token time on first chunk', () => {
      processStreamChunk(state, 'hello')
      expect(state.firstTokenTime).not.toBeNull()
      expect(state.chunkCount).toBe(1)
    })

    it('increments chunk count', () => {
      processStreamChunk(state, 'chunk1')
      processStreamChunk(state, 'chunk2')
      expect(state.chunkCount).toBe(2)
    })
  })

  describe('getStreamStats', () => {
    it('returns zero values for empty stream', () => {
      const stats = getStreamStats(state)
      expect(stats.totalChunks).toBe(0)
      expect(stats.firstTokenMs).toBeNull()
      expect(stats.durationMs).toBe(0)
    })

    it('returns correct stats after processing chunks', () => {
      processStreamChunk(state, 'test')
      const stats = getStreamStats(state)
      expect(stats.totalChunks).toBe(1)
      expect(stats.firstTokenMs).toBeGreaterThanOrEqual(0)
      expect(stats.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('flushStreamBuffer', () => {
    it('returns empty string (no-op)', () => {
      const result = flushStreamBuffer(state)
      expect(result).toBe('')
    })
  })
})
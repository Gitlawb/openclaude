import { describe, expect, it, vi, beforeEach, afterEach } from 'bun:test'
import {
  createCorrelationId,
  logApiCallStart,
  logApiCallEnd,
} from './requestLogging.js'

// Mock logForDebugging
vi.mock('./debug.js', () => ({
  logForDebugging: vi.fn(),
}))

import { logForDebugging } from './debug.js'

describe('requestLogging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createCorrelationId', () => {
    it('returns a non-empty string', () => {
      const id = createCorrelationId()
      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
    })

    it('returns unique IDs', () => {
      const id1 = createCorrelationId()
      const id2 = createCorrelationId()
      expect(id1).not.toBe(id2)
    })
  })

  describe('logApiCallStart', () => {
    it('returns correlation ID and start time', () => {
      const result = logApiCallStart('openai', 'gpt-4o')
      expect(result.correlationId).toBeTruthy()
      expect(result.startTime).toBeGreaterThan(0)
    })

    it('logs with correct structure', () => {
      logApiCallStart('ollama', 'llama3')
      expect(logForDebugging).toHaveBeenCalledWith(
        expect.stringContaining('"type":"api_call_start"'),
        { level: 'debug' },
      )
    })
  })

  describe('logApiCallEnd', () => {
    it('logs success with correct structure', () => {
      const { correlationId, startTime } = logApiCallStart('openai', 'gpt-4o')
      logApiCallEnd(
        correlationId,
        startTime,
        'gpt-4o',
        'success',
        100,
        50,
        false,
      )

      expect(logForDebugging).toHaveBeenLastCalledWith(
        expect.stringContaining('"type":"api_call_end"'),
        { level: 'debug' },
      )
    })

    it('logs error with error level', () => {
      const { correlationId, startTime } = logApiCallStart('openai', 'gpt-4o')
      logApiCallEnd(
        correlationId,
        startTime,
        'gpt-4o',
        'error',
        0,
        0,
        false,
        undefined,
        undefined,
        'Network error',
      )

      expect(logForDebugging).toHaveBeenLastCalledWith(
        expect.stringContaining('"type":"api_call_error"'),
        { level: 'error' },
      )
    })
  })
})
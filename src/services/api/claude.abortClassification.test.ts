import { describe, expect, test } from 'bun:test'
import { shouldCreateUserInterruptionMessage } from '../../utils/abortReasons.js'
import { getClaudeStreamingAbortLogMessage } from './claude.js'

describe('Claude stream abort classification wiring', () => {
  test('formats timeout abort logs as timeout aborts, not user aborts', () => {
    expect(
      getClaudeStreamingAbortLogMessage(
        { reason: 'query-timeout' },
        new Error('Request was aborted.'),
      ),
    ).toBe('Streaming aborted by query timeout: Request was aborted.')
    expect(
      getClaudeStreamingAbortLogMessage(
        { reason: 'hard_max' },
        new Error('Request was aborted.'),
      ),
    ).toBe('Streaming aborted by query hard timeout: Request was aborted.')
    expect(shouldCreateUserInterruptionMessage('query-timeout')).toBe(false)
    expect(shouldCreateUserInterruptionMessage('hard_max')).toBe(false)
  })

  test('formats non-timeout abort logs by their normalized stream reason', () => {
    expect(
      getClaudeStreamingAbortLogMessage(
        { reason: 'background' },
        new Error('Request was aborted.'),
      ),
    ).toBe('Streaming aborted for backgrounding: Request was aborted.')
    expect(
      getClaudeStreamingAbortLogMessage(
        { reason: 'streaming_fallback' },
        new Error('Request was aborted.'),
      ),
    ).toBe(
      'Streaming aborted because side task was cancelled: Request was aborted.',
    )
    expect(shouldCreateUserInterruptionMessage('background')).toBe(false)
    expect(shouldCreateUserInterruptionMessage('streaming_fallback')).toBe(
      false,
    )
  })

  test('keeps actual user aborts user-facing for stream logs and advisor gating', () => {
    const defaultAbort = new AbortController()
    defaultAbort.abort()

    expect(
      getClaudeStreamingAbortLogMessage(
        defaultAbort.signal,
        new Error('Request was aborted.'),
      ),
    ).toBe('Streaming aborted by user: Request was aborted.')
    expect(shouldCreateUserInterruptionMessage(defaultAbort.signal.reason)).toBe(
      true,
    )
  })
})

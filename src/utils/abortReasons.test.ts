import { describe, expect, test } from 'bun:test'
import {
  type AbortReason,
  getMissingToolResultAbortMessage,
  getQueryAbortSystemMessage,
  getShellAbortMessage,
  getStreamingAbortMessage,
  isQueryLevelAbort,
  normalizeAbortReason,
  shouldCreateUserInterruptionMessage,
} from './abortReasons.js'

describe('abort reason normalization', () => {
  test('normalizes known query and user abort reasons', () => {
    expect(normalizeAbortReason('query-timeout')).toBe('query-timeout')
    expect(normalizeAbortReason('hard-max-query-timeout')).toBe(
      'hard-max-query-timeout',
    )
    expect(normalizeAbortReason('user-cancel')).toBe('user-abort')
    expect(normalizeAbortReason('interrupt')).toBe('interrupt')
    expect(normalizeAbortReason('background')).toBe('background')
    expect(normalizeAbortReason('parent-ended')).toBe('parent-ended')
    expect(normalizeAbortReason('agent-summary-superseded')).toBe(
      'agent-summary-superseded',
    )
    expect(normalizeAbortReason('memory-extraction-superseded')).toBe(
      'memory-extraction-superseded',
    )
    expect(normalizeAbortReason('hard_max')).toBe('hard-max-query-timeout')
    expect(normalizeAbortReason('streaming_fallback')).toBe(
      'side-task-cancelled',
    )
    expect(normalizeAbortReason('sibling_error')).toBe('side-task-cancelled')
  })

  test('keeps tool timeout distinct from abort cancellations', () => {
    expect(normalizeAbortReason(new DOMException('', 'AbortError'))).toBe(
      'user-abort',
    )
    expect(
      normalizeAbortReason({
        name: 'AbortError',
      }),
    ).toBe('user-abort')
    expect(normalizeAbortReason(new DOMException('', 'TimeoutError'))).toBe(
      'tool-timeout',
    )
    expect(
      normalizeAbortReason({
        name: 'TimeoutError',
      }),
    ).toBe('tool-timeout')
    expect(isQueryLevelAbort('tool-timeout')).toBe(false)
    expect(isQueryLevelAbort('query-timeout')).toBe(true)
  })

  test('falls back to unknown abort without leaking raw reason text', () => {
    expect(normalizeAbortReason('unexpected-secret-ish-reason')).toBe(
      'unknown-abort',
    )
    expect(getShellAbortMessage('unknown-abort')).toBe(
      'Command was interrupted because the enclosing query was aborted.',
    )
  })

  test('returns distinct safe messages for user-facing abort reasons', () => {
    expect(getShellAbortMessage('query-timeout')).toBe(
      'Command was interrupted because the query hit its timeout.',
    )
    expect(getShellAbortMessage('hard-max-query-timeout')).toBe(
      'Command was interrupted because the query hit its hard timeout.',
    )
    expect(getShellAbortMessage('background')).toBe(
      'Command was interrupted because the enclosing query was backgrounded.',
    )
    expect(getShellAbortMessage('tool-timeout')).toBe(
      'Command timed out before completion.',
    )
  })

  test('formats streaming abort logs from normalized abort reasons', () => {
    expect(getStreamingAbortMessage('user-cancel', 'Request was aborted.')).toBe(
      'Streaming aborted by user: Request was aborted.',
    )
    expect(
      getStreamingAbortMessage('query-timeout', 'Request was aborted.'),
    ).toBe('Streaming aborted by query timeout: Request was aborted.')
    expect(getStreamingAbortMessage('hard_max', 'Request was aborted.')).toBe(
      'Streaming aborted by query hard timeout: Request was aborted.',
    )
    expect(getStreamingAbortMessage('background', 'Request was aborted.')).toBe(
      'Streaming aborted for backgrounding: Request was aborted.',
    )
    expect(
      getStreamingAbortMessage('streaming_fallback', 'Request was aborted.'),
    ).toBe(
      'Streaming aborted because side task was cancelled: Request was aborted.',
    )
    expect(
      getStreamingAbortMessage(
        'agent-summary-superseded',
        'Request was aborted.',
      ),
    ).toBe(
      'Streaming aborted because agent summary was superseded: Request was aborted.',
    )
    expect(
      getStreamingAbortMessage(
        'memory-extraction-superseded',
        'Request was aborted.',
      ),
    ).toBe(
      'Streaming aborted because memory extraction was superseded: Request was aborted.',
    )
  })

  test('only actual user cancellation creates user interruption transcript text', () => {
    const defaultAbort = new AbortController()
    defaultAbort.abort()

    expect(shouldCreateUserInterruptionMessage('user-cancel')).toBe(true)
    expect(shouldCreateUserInterruptionMessage('user-abort')).toBe(true)
    expect(normalizeAbortReason(defaultAbort.signal.reason)).toBe('user-abort')
    expect(
      shouldCreateUserInterruptionMessage(defaultAbort.signal.reason),
    ).toBe(true)
    expect(shouldCreateUserInterruptionMessage('interrupt')).toBe(false)
    expect(shouldCreateUserInterruptionMessage('query-timeout')).toBe(false)
    expect(shouldCreateUserInterruptionMessage('hard_max')).toBe(false)
    expect(shouldCreateUserInterruptionMessage('background')).toBe(false)
    expect(shouldCreateUserInterruptionMessage('agent-summary-superseded')).toBe(
      false,
    )
    expect(
      shouldCreateUserInterruptionMessage('memory-extraction-superseded'),
    ).toBe(false)
    expect(shouldCreateUserInterruptionMessage('streaming_fallback')).toBe(
      false,
    )
    expect(getQueryAbortSystemMessage('query-timeout')).toBe(
      'Query timed out before completion.',
    )
    expect(getQueryAbortSystemMessage('hard_max')).toBe(
      'Query reached the hard maximum runtime and was stopped before completion.',
    )
    expect(getQueryAbortSystemMessage('background')).toBe(
      'Query was backgrounded before completion.',
    )
    expect(getQueryAbortSystemMessage('streaming_fallback')).toBe(
      'Query stopped because a side task was cancelled.',
    )
    expect(getQueryAbortSystemMessage('agent-summary-superseded')).toBeNull()
    expect(getQueryAbortSystemMessage('memory-extraction-superseded')).toBeNull()
    expect(getQueryAbortSystemMessage('parent-ended')).toBe(
      'Query stopped because the parent query ended.',
    )
    expect(getQueryAbortSystemMessage('user-cancel')).toBeNull()
    expect(getMissingToolResultAbortMessage('query-timeout')).toBe(
      'Tool use was interrupted because the query timed out.',
    )
    expect(getMissingToolResultAbortMessage('hard_max')).toBe(
      'Tool use was interrupted because the query reached its hard maximum runtime.',
    )
    expect(getMissingToolResultAbortMessage('user-cancel')).toBe(
      'Interrupted by user',
    )
    expect(
      getMissingToolResultAbortMessage(defaultAbort.signal.reason),
    ).toBe('Interrupted by user')
    expect(
      getStreamingAbortMessage(
        defaultAbort.signal.reason,
        'Request was aborted.',
      ),
    ).toBe('Streaming aborted by user: Request was aborted.')
  })

  test('returns a message for every abort reason', () => {
    const abortReasons: Record<AbortReason, true> = {
      'query-timeout': true,
      'hard-max-query-timeout': true,
      'user-abort': true,
      interrupt: true,
      background: true,
      'side-task-cancelled': true,
      'agent-summary-superseded': true,
      'memory-extraction-superseded': true,
      'tool-timeout': true,
      'parent-ended': true,
      'unknown-abort': true,
    }

    for (const reason of Object.keys(abortReasons) as AbortReason[]) {
      expect(getShellAbortMessage(reason).length).toBeGreaterThan(0)
    }
  })
})

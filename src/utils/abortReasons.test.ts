import { describe, expect, test } from 'bun:test'
import {
  type AbortReason,
  getShellAbortMessage,
  isQueryLevelAbort,
  normalizeAbortReason,
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
  })

  test('keeps tool timeout distinct from abort cancellations', () => {
    expect(normalizeAbortReason(new DOMException('', 'TimeoutError'))).toBe(
      'tool-timeout',
    )
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

  test('returns a message for every abort reason', () => {
    const abortReasons: Record<AbortReason, true> = {
      'query-timeout': true,
      'hard-max-query-timeout': true,
      'user-abort': true,
      interrupt: true,
      background: true,
      'tool-timeout': true,
      'parent-ended': true,
      'unknown-abort': true,
    }

    for (const reason of Object.keys(abortReasons) as AbortReason[]) {
      expect(getShellAbortMessage(reason).length).toBeGreaterThan(0)
    }
  })
})

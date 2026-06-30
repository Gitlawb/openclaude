import { describe, expect, test } from 'vitest'
import {
  formatQueryLifecycleAbortSignalReason,
  formatQueryLifecycleLogMessage,
  type QueryLifecycleContext,
} from './queryLifecycle.js'

describe('query lifecycle log formatting', () => {
  test('keeps timeout context abort reason distinct from abort signal reason', () => {
    const context: QueryLifecycleContext = {
      queryId: 'query-1',
      queryGeneration: 1,
      querySource: 'repl_main_thread',
      startedAt: 1,
      terminalReason: 'query-timeout',
      abortReason: 'idle',
    }

    const line = formatQueryLifecycleLogMessage(
      'abort_requested',
      context,
      formatQueryLifecycleAbortSignalReason('query-timeout'),
    )

    expect(line).toContain('abortReason=idle')
    expect(line).toContain('abortSignalReason=query-timeout')
    expect(line).not.toContain('abortReason=query-timeout')
    expect(line.match(/\babortReason=/g)).toHaveLength(1)
  })
})

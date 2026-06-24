import { describe, expect, test } from 'bun:test'

import { ReplayIndexBuilder } from './replayIndexBuilder.js'

describe('ReplayIndexBuilder', () => {
  test('records repeated attempts for repeated tool/input executions', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackToolStart('tool-1', 'Bash', { command: 'bun test' })
    builder.trackToolEnd('tool-1', 'Bash', 'error', 'failed')

    builder.trackToolStart('tool-2', 'Bash', { command: 'bun test' })
    builder.trackToolEnd('tool-2', 'Bash', 'success', 'passed')

    const index = builder.build('session-1')
    const first = index.steps[0]
    const second = index.steps[1]

    expect(first?.type).toBe('tool')
    expect(second?.type).toBe('tool')
    if (first?.type !== 'tool' || second?.type !== 'tool') {
      throw new Error('expected tool replay steps')
    }

    expect(first.repeatedAttemptNumber).toBe(1)
    expect(first.isRepeatedAttempt).toBe(false)
    expect(second.repeatedAttemptNumber).toBe(2)
    expect(second.isRepeatedAttempt).toBe(true)
    expect(index.summary.repeatedAttempts).toBe(1)
  })

  test('normalizes input key order when detecting repeated attempts', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackToolStart('tool-1', 'Edit', {
      file_path: 'src/a.ts',
      old_string: 'old',
      new_string: 'new',
    })
    builder.trackToolEnd('tool-1', 'Edit', 'error', 'failed')

    builder.trackToolStart('tool-2', 'Edit', {
      new_string: 'new',
      old_string: 'old',
      file_path: 'src/a.ts',
    })
    builder.trackToolEnd('tool-2', 'Edit', 'success', 'patched', ['src/a.ts'])

    const index = builder.build('session-1')
    const second = index.steps[1]

    expect(second?.type).toBe('tool')
    if (second?.type !== 'tool') {
      throw new Error('expected tool replay step')
    }

    expect(second.repeatedAttemptNumber).toBe(2)
    expect(second.filesModified).toEqual(['src/a.ts'])
    expect(index.summary.filesModified).toEqual(['src/a.ts'])
    expect(index.summary.repeatedAttempts).toBe(1)
  })

  test('records real retry events separately from repeated attempts', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackRetry('api', 'rate limited', '2026-06-17T00:00:00.000Z', {
      attempt: 2,
      maxRetries: 5,
      retryDelayMs: 1000,
    })
    builder.trackRetry(
      'permission',
      'Allowed Bash(git status)',
      '2026-06-17T00:00:01.000Z',
      {
        commands: ['Bash(git status)'],
      },
    )

    const index = builder.build('session-1')
    const first = index.steps[0]
    const second = index.steps[1]

    expect(first?.type).toBe('retry')
    expect(second?.type).toBe('retry')
    if (first?.type !== 'retry' || second?.type !== 'retry') {
      throw new Error('expected retry replay steps')
    }

    expect(first.retryType).toBe('api')
    expect(first.attempt).toBe(2)
    expect(first.maxRetries).toBe(5)
    expect(first.retryDelayMs).toBe(1000)
    expect(second.retryType).toBe('permission')
    expect(second.commands).toEqual(['Bash(git status)'])
    expect(index.summary.retryAttempts).toBe(2)
    expect(index.summary.repeatedAttempts).toBe(0)
  })

  test('uses earliest and latest timestamps for session boundaries', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackUserMessage('later request', '2026-01-01T00:00:10.000Z')
    builder.trackRetry('api', 'middle retry', '2026-01-01T00:00:05.000Z')
    builder.trackUserMessage('earlier request', '2026-01-01T00:00:01.000Z')

    const index = builder.build('session-1')

    expect(index.summary.startTimestamp).toBe('2026-01-01T00:00:01.000Z')
    expect(index.summary.endTimestamp).toBe('2026-01-01T00:00:10.000Z')
  })

  test('uses elapsed session bounds for summary duration', () => {
    const builder = new ReplayIndexBuilder()

    builder.trackUserMessage('start', '2026-01-01T00:00:00.000Z')
    builder.trackRetry('api', 'rate limited', '2026-01-01T00:00:05.000Z')

    const index = builder.build('session-1')

    expect(index.summary.durationMs).toBe(5000)
  })
})

import { describe, expect, test } from 'bun:test'

import { formatReplayDuration } from './replayFormat.js'

describe('formatReplayDuration', () => {
  test('preserves sub-second precision for replay timings', () => {
    expect(formatReplayDuration(1)).toBe('1ms')
    expect(formatReplayDuration(500)).toBe('500ms')
    expect(formatReplayDuration(999)).toBe('999ms')
  })

  test('delegates longer durations to the shared formatter', () => {
    expect(formatReplayDuration(0)).toBe('0s')
    expect(formatReplayDuration(1000)).toBe('1s')
    expect(formatReplayDuration(65000)).toBe('1m 5s')
  })
})

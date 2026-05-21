import { describe, expect, test } from 'bun:test'

import { isGoalStatusSystemMessage } from './services/goal/status.js'

describe('QueryEngine goal status visibility', () => {
  test('recognizes only goal status informational messages for SDK visibility', () => {
    expect(
      isGoalStatusSystemMessage({
        type: 'system',
        subtype: 'informational',
        content: 'Goal achieved: tests pass',
      } as any),
    ).toBe(true)

    expect(
      isGoalStatusSystemMessage({
        type: 'system',
        subtype: 'informational',
        content: 'Goal not complete: tests missing',
      } as any),
    ).toBe(true)

    expect(
      isGoalStatusSystemMessage({
        type: 'system',
        subtype: 'informational',
        content: 'Stop hook failed: bad hook',
      } as any),
    ).toBe(false)
  })
})

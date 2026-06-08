import { describe, expect, test } from 'bun:test'

import { toSDKGoalStatusMessage } from './services/goal/sdk.js'
import { isGoalStatusSystemMessage } from './services/goal/status.js'
import { createSystemMessage } from './utils/messages.js'

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
        content: 'Goal paused: evaluator failed',
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

  test('maps goal status system messages to SDK assistant output', () => {
    const systemMessage = createSystemMessage(
      'Goal achieved: tests pass',
      'info',
    )
    const goalStatusMessage = toSDKGoalStatusMessage(systemMessage)

    expect(goalStatusMessage).toBeTruthy()
    expect(goalStatusMessage?.type).toBe('assistant')
    expect(goalStatusMessage?.message.content[0]).toEqual({
      type: 'text',
      text: 'Goal achieved: tests pass',
    })
    expect(goalStatusMessage?.parent_tool_use_id).toBeNull()
    expect(goalStatusMessage?.uuid).toBe(systemMessage.uuid)
  })
})

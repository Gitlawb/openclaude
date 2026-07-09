import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import type { Message } from '../../types/message.js'
import {
  createToolCircuitSession,
  extractToolObservation,
  observeToolMessage,
} from './circuitToolBridge.js'

function toolResultMsg(
  toolUseId: string,
  content: string,
  isError = false,
): Message {
  return {
    type: 'user',
    uuid: 't1',
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
  } as Message
}

describe('circuitToolBridge', () => {
  const saved = process.env.OPENCLAUDE_AUTONOMY

  beforeEach(() => {
    process.env.OPENCLAUDE_AUTONOMY = '1'
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENCLAUDE_AUTONOMY
    else process.env.OPENCLAUDE_AUTONOMY = saved
  })

  test('createToolCircuitSession when autonomy env on', () => {
    const s = createToolCircuitSession()
    expect(s).not.toBeNull()
  })

  test('extractToolObservation detects errors', () => {
    const msg = toolResultMsg('id1', 'boom', true)
    const obs = extractToolObservation(msg, 'Bash')
    expect(obs?.error).toContain('boom')
  })

  test('observeToolMessage trips after repeated errors', () => {
    const session = createToolCircuitSession()!
    const msg = toolResultMsg('id1', 'exit 1', true)
    expect(observeToolMessage(session, msg, 'Bash')).toBeNull()
    expect(observeToolMessage(session, msg, 'Bash')).toBeNull()
    const trip = observeToolMessage(session, msg, 'Bash')
    expect(trip).toBeTruthy()
    expect(trip).toContain('Circuit breaker')
  })
})

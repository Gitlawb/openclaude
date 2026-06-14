import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import { isToolResultMessage, isTurnStart } from './spanSelection.js'

function userMsg(content: any = 'hi', extra: Record<string, unknown> = {}): Message {
  return { type: 'user', uuid: 'u', timestamp: '', message: { role: 'user', content }, ...extra } as unknown as Message
}
function assistantMsg(): Message {
  return { type: 'assistant', uuid: 'a', timestamp: '', message: { role: 'assistant', content: 'ok' } } as unknown as Message
}

describe('isToolResultMessage', () => {
  test('true for user message with a tool_result block', () => {
    expect(isToolResultMessage(userMsg([{ type: 'tool_result', tool_use_id: 'x', content: 'r' }]))).toBe(true)
  })
  test('false for plain user text', () => {
    expect(isToolResultMessage(userMsg('hello'))).toBe(false)
  })
  test('false for assistant message', () => {
    expect(isToolResultMessage(assistantMsg())).toBe(false)
  })
})

describe('isTurnStart', () => {
  test('true for a plain user message', () => {
    expect(isTurnStart(userMsg('hello'))).toBe(true)
  })
  test('false for a tool_result user message', () => {
    expect(isTurnStart(userMsg([{ type: 'tool_result', tool_use_id: 'x', content: 'r' }]))).toBe(false)
  })
  test('false for a meta user message', () => {
    expect(isTurnStart(userMsg('hello', { isMeta: true }))).toBe(false)
  })
  test('false for an assistant message', () => {
    expect(isTurnStart(assistantMsg())).toBe(false)
  })
})

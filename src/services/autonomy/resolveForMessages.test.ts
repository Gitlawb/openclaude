import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import {
  extractUserTextFromMessages,
  messagesHaveImage,
} from './resolveForMessages.js'

function userMsg(text: string): Message {
  return {
    type: 'user',
    uuid: 'u1',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  } as Message
}

function userBlocks(
  blocks: Array<{ type: string; text?: string }>,
): Message {
  return {
    type: 'user',
    uuid: 'u2',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: blocks },
  } as Message
}

describe('extractUserTextFromMessages', () => {
  test('joins string user content', () => {
    const text = extractUserTextFromMessages([
      userMsg('hello'),
      userMsg('world'),
    ])
    expect(text).toContain('hello')
    expect(text).toContain('world')
  })

  test('extracts text blocks', () => {
    const text = extractUserTextFromMessages([
      userBlocks([{ type: 'text', text: 'fix src/a.ts' }]),
    ])
    expect(text).toBe('fix src/a.ts')
  })

  test('detects images', () => {
    expect(
      messagesHaveImage([
        userBlocks([{ type: 'image' }, { type: 'text', text: 'what is this' }]),
      ]),
    ).toBe(true)
    expect(messagesHaveImage([userMsg('no image')])).toBe(false)
  })
})

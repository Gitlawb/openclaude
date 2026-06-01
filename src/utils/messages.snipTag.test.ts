import { describe, expect, test } from 'bun:test'
import {
  appendMessageTagToUserMessage,
  createUserMessage,
  deriveShortMessageId,
} from './messages.js'
import type { UserMessage } from '../types/message.js'

const UUID = 'a1b2c3d4-0000-0000-0000-000000000099'

function tagFor(uuid: string): string {
  return `[id:${deriveShortMessageId(uuid)}]`
}

describe('appendMessageTagToUserMessage', () => {
  test('appends the tag to string content', () => {
    const msg = { ...createUserMessage({ content: 'hello' }), uuid: UUID }
    const out = appendMessageTagToUserMessage(msg as UserMessage)
    expect(out.message.content).toBe(`hello\n${tagFor(UUID)}`)
  })

  test('appends the tag to the last text block of array content', () => {
    const msg = {
      ...createUserMessage({
        content: [{ type: 'text', text: 'first' }],
      }),
      uuid: UUID,
    }
    const out = appendMessageTagToUserMessage(msg as UserMessage)
    const blocks = out.message.content as any[]
    expect(blocks[blocks.length - 1].text).toBe(`first\n${tagFor(UUID)}`)
  })

  test('adds a visible tag to a pure tool_result message (large Read/Bash output)', () => {
    const msg = {
      ...createUserMessage({
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_abc',
            content: 'a huge file read',
          },
        ],
      }),
      uuid: UUID,
    }
    const out = appendMessageTagToUserMessage(msg as UserMessage)
    const blocks = out.message.content as any[]
    // The tool_result block is preserved so snip pairing still works.
    expect(blocks.some(b => b.type === 'tool_result')).toBe(true)
    // A visible [id:...] tag is now present for the model to reference.
    const flattened = JSON.stringify(blocks)
    expect(flattened).toContain(tagFor(UUID))
  })

  test('leaves a meta message untouched', () => {
    const msg = {
      ...createUserMessage({ content: 'meta', isMeta: true }),
      uuid: UUID,
    }
    const out = appendMessageTagToUserMessage(msg as UserMessage)
    expect(out.message.content).toBe('meta')
  })
})

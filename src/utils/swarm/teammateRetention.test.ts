import { describe, expect, it } from 'bun:test'
import type { Message } from '../../types/message.js'
import {
  capTeammateMessages,
  TEAMMATE_CONTEXT_MESSAGES_CAP,
} from './teammateRetention.js'

function userText(text: string): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  } as Message
}

function assistantToolUse(id: string): Message {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Read', input: {} }],
      id: `msg-${id}`,
      model: 'test',
      usage: {},
    },
  } as Message
}

function userToolResult(toolUseId: string): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'result' },
      ],
    },
  } as Message
}

/** Collect every tool_result's tool_use_id referenced in the messages. */
function referencedToolUseIds(messages: readonly Message[]): string[] {
  const ids: string[] = []
  for (const m of messages) {
    const content = (m as any).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result') ids.push(block.tool_use_id)
    }
  }
  return ids
}

/** Collect every tool_use id present in the messages. */
function presentToolUseIds(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.type !== 'assistant') continue
    const content = (m as any).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_use') ids.add(block.id)
    }
  }
  return ids
}

describe('capTeammateMessages', () => {
  it('returns the same reference (no-op) when within the cap', () => {
    const messages = [userText('a'), userText('b'), userText('c')]
    expect(capTeammateMessages(messages, 10)).toBe(messages)
  })

  it('caps to the most recent N messages', () => {
    const messages = Array.from({ length: 200 }, (_, i) => userText(`m${i}`))
    const result = capTeammateMessages(messages, 50)
    expect(result.length).toBeLessThanOrEqual(50)
    // Keeps the most recent ones (sliding window from the end).
    const lastText = (result.at(-1) as any).message.content
    expect(lastText).toBe('m199')
  })

  it('uses TEAMMATE_CONTEXT_MESSAGES_CAP by default', () => {
    const messages = Array.from(
      { length: TEAMMATE_CONTEXT_MESSAGES_CAP + 100 },
      (_, i) => userText(`m${i}`),
    )
    const result = capTeammateMessages(messages)
    expect(result.length).toBeLessThanOrEqual(TEAMMATE_CONTEXT_MESSAGES_CAP)
  })

  it('never retains a tool_result whose tool_use was pruned (no orphans)', () => {
    // Build pairs: [tool_use(i), tool_result(i)] repeated. A naive slice that
    // cut between a tool_use and its tool_result would orphan the result.
    const messages: Message[] = []
    for (let i = 0; i < 100; i++) {
      messages.push(assistantToolUse(`tu${i}`))
      messages.push(userToolResult(`tu${i}`))
    }

    // Odd cap forces the slice boundary to land mid-pair for some pair.
    const result = capTeammateMessages(messages, 51)

    const present = presentToolUseIds(result)
    for (const referenced of referencedToolUseIds(result)) {
      // Every retained tool_result must have its tool_use retained too.
      expect(present.has(referenced)).toBe(true)
    }
  })

  it('drops a leading orphaned tool_result message at the cut boundary', () => {
    // Window slice will start on the tool_result, orphaning it from its
    // tool_use which sits just before the boundary.
    const messages: Message[] = [
      assistantToolUse('orphan'), // index 0 — will be sliced off
      userToolResult('orphan'), // index 1 — becomes a leading orphan
      userText('keep-1'),
      userText('keep-2'),
    ]

    const result = capTeammateMessages(messages, 3)

    // The orphaned tool_result message must be dropped, not retained.
    expect(referencedToolUseIds(result)).not.toContain('orphan')
    // The plain user messages survive.
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps a tool_result whose tool_use survives the cut', () => {
    const messages: Message[] = [
      userText('old'), // sliced off
      assistantToolUse('tu-keep'),
      userToolResult('tu-keep'),
      userText('newest'),
    ]

    const result = capTeammateMessages(messages, 3)

    const present = presentToolUseIds(result)
    expect(present.has('tu-keep')).toBe(true)
    expect(referencedToolUseIds(result)).toContain('tu-keep')
  })

  it('strips only orphaned tool_result blocks from a mixed-content message', () => {
    // A user message that carries one orphaned and one valid tool_result.
    const mixed: Message = {
      type: 'user',
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'gone', content: 'x' },
          { type: 'tool_result', tool_use_id: 'tu-keep', content: 'y' },
        ],
      },
    } as Message

    const messages: Message[] = [
      assistantToolUse('gone'), // sliced off
      assistantToolUse('tu-keep'),
      mixed,
      userText('newest'),
    ]

    const result = capTeammateMessages(messages, 3)

    const referenced = referencedToolUseIds(result)
    expect(referenced).toContain('tu-keep')
    expect(referenced).not.toContain('gone')
  })

  it('leaves string-content user messages untouched', () => {
    const messages = Array.from({ length: 100 }, (_, i) => userText(`m${i}`))
    const result = capTeammateMessages(messages, 10)
    for (const m of result) {
      expect(typeof (m as any).message.content).toBe('string')
    }
  })
})

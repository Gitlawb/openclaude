import { beforeEach, describe, expect, test } from 'bun:test'
import { createAssistantMessage, createUserMessage, deriveShortMessageId } from '../../utils/messages.js'
import {
  _resetForTesting,
  isSnipRuntimeEnabled,
  markForSnip,
  shouldNudgeForSnips,
  SNIP_NUDGE_TEXT,
  snipCompactIfNeeded,
} from './snipCompact.js'

beforeEach(() => {
  _resetForTesting()
})

function makeUser(uuid: string, text = 'hello') {
  const msg = createUserMessage({ content: text })
  return { ...msg, uuid }
}

function makeAssistant(uuid: string) {
  const msg = createAssistantMessage({ content: 'ok' })
  return { ...msg, uuid }
}

describe('isSnipRuntimeEnabled', () => {
  test('returns true', () => {
    expect(isSnipRuntimeEnabled()).toBe(true)
  })
})

describe('SNIP_NUDGE_TEXT', () => {
  test('is a non-empty string mentioning snip', () => {
    expect(typeof SNIP_NUDGE_TEXT).toBe('string')
    expect(SNIP_NUDGE_TEXT.length).toBeGreaterThan(20)
    expect(SNIP_NUDGE_TEXT.toLowerCase()).toContain('snip')
  })
})

describe('snipCompactIfNeeded', () => {
  test('no-ops when nothing is pending', () => {
    const messages = [makeUser('uuid-1'), makeUser('uuid-2')]
    const result = snipCompactIfNeeded(messages)
    expect(result.tokensFreed).toBe(0)
    expect(result.boundaryMessage).toBeUndefined()
    expect(result.messages).toHaveLength(2)
  })

  test('removes a message whose short ID was marked for snip', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000001'
    const shortId = deriveShortMessageId(uuid)
    const messages = [makeUser(uuid, 'old stuff'), makeUser('keep-uuid', 'keep me')]
    markForSnip([shortId])
    const result = snipCompactIfNeeded(messages)
    expect(result.messages.map((m: any) => m.uuid)).toEqual(['keep-uuid'])
    expect(result.tokensFreed).toBeGreaterThan(0)
  })

  test('returns a boundary message with snipMetadata.removedUuids', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000002'
    const shortId = deriveShortMessageId(uuid)
    markForSnip([shortId])
    const result = snipCompactIfNeeded([makeUser(uuid)])
    expect(result.boundaryMessage).toBeDefined()
    expect(result.boundaryMessage?.snipMetadata?.removedUuids).toContain(uuid)
  })

  test('clears pending set after execution so second call is a no-op', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000003'
    const shortId = deriveShortMessageId(uuid)
    const messages = [makeUser(uuid), makeUser('other')]
    markForSnip([shortId])
    snipCompactIfNeeded(messages)
    const second = snipCompactIfNeeded([makeUser('other')])
    expect(second.tokensFreed).toBe(0)
    expect(second.boundaryMessage).toBeUndefined()
  })

  test('also removes tool-result messages for snipped assistant tool calls', () => {
    const assistantUuid = 'a1b2c3d4-0000-0000-0000-000000000004'
    const toolUseId = 'tu-001'
    const shortId = deriveShortMessageId(assistantUuid)
    const assistantMsg = {
      ...makeAssistant(assistantUuid),
      message: {
        content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: {} }],
      },
    }
    const toolResultMsg = createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'file contents' }],
    })
    markForSnip([shortId])
    const result = snipCompactIfNeeded([assistantMsg, toolResultMsg, makeUser('survivor')])
    expect(result.messages.map((m: any) => m.uuid ?? 'noid')).not.toContain(assistantUuid)
    const hasToolResult = result.messages.some((m: any) =>
      Array.isArray(m.message?.content) &&
      m.message.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === toolUseId)
    )
    expect(hasToolResult).toBe(false)
    expect(result.messages.some((m: any) => m.uuid === 'survivor')).toBe(true)
  })

  test('ignores short IDs that do not match any message (graceful)', () => {
    const messages = [makeUser('real-uuid')]
    markForSnip(['xxxxxx'])
    const result = snipCompactIfNeeded(messages)
    expect(result.messages).toHaveLength(1)
    expect(result.tokensFreed).toBe(0)
    expect(result.boundaryMessage).toBeUndefined()
  })
})

describe('shouldNudgeForSnips', () => {
  test('returns false for an empty message list', () => {
    expect(shouldNudgeForSnips([])).toBe(false)
  })

  test('returns false when there is a compact_boundary in recent history', () => {
    const messages = [
      { type: 'system', subtype: 'compact_boundary' },
      makeUser('u1', 'x'.repeat(200)),
    ]
    expect(shouldNudgeForSnips(messages)).toBe(false)
  })

  test('returns false when there is a snip boundary in recent history', () => {
    const messages = [
      { type: 'system', snipMetadata: { removedUuids: [] } },
      makeUser('u1', 'x'.repeat(200)),
    ]
    expect(shouldNudgeForSnips(messages)).toBe(false)
  })

  test('returns true when enough tokens have accumulated since last reset', () => {
    const bigChunk = 'x'.repeat(12_000)
    const messages = [
      makeUser('u1', bigChunk),
      makeUser('u2', bigChunk),
      makeUser('u3', bigChunk),
      makeUser('u4', bigChunk),
    ]
    expect(shouldNudgeForSnips(messages)).toBe(true)
  })
})

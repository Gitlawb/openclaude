import { randomUUID } from 'crypto'
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import {
  buildCollapsePlaceholder,
  deriveCollapseId,
  getSpanUuids,
  isCollapsePlaceholder,
  isWithinCollapsedSpan,
  resetCollapseIdCounter,
} from './collapseUtils.js'
import type { Message } from '../../types/message.js'

function uid(s: string): UUID {
  // Replace underscores with dashes to produce valid UUID-looking strings
  return `00000000-0000-4000-8000-${s.padStart(12, '0')}` as UUID
}

function makeMsg(id: string): Message {
  return {
    type: 'user',
    uuid: uid(id),
    timestamp: new Date().toISOString(),
    message: { content: 'hello', role: 'user' as const },
  } as unknown as Message
}

function makeSysMsg(content: string): Message {
  return {
    type: 'system',
    subtype: 'informational' as const,
    content,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    isMeta: true,
  } as unknown as Message
}

describe('deriveCollapseId', () => {
  test('derives 16-digit sequential IDs', () => {
    resetCollapseIdCounter()
    expect(deriveCollapseId(uid('a'))).toBe('0000000000000001')
    expect(deriveCollapseId(uid('b'))).toBe('0000000000000002')
  })

  test('resets and reseeds correctly', () => {
    resetCollapseIdCounter(42)
    expect(deriveCollapseId(uid('x'))).toBe('0000000000000043')
  })

  test('counter stability across calls', () => {
    resetCollapseIdCounter()
    expect(deriveCollapseId(uid('a'))).toBe('0000000000000001')
    expect(deriveCollapseId(uid('b'))).toBe('0000000000000002')
    expect(deriveCollapseId(uid('c'))).toBe('0000000000000003')
  })
})

describe('getSpanUuids', () => {
  const msgs: Message[] = ['a', 'b', 'c', 'd', 'e'].map(makeMsg)

  test('extracts inclusive span', () => {
    expect(getSpanUuids(msgs, uid('b'), uid('d'))).toEqual([uid('b'), uid('c'), uid('d')])
  })

  test('single message span', () => {
    expect(getSpanUuids(msgs, uid('c'), uid('c'))).toEqual([uid('c')])
  })

  test('first boundary missing returns empty', () => {
    expect(getSpanUuids(msgs, uid('x'), uid('d'))).toEqual([])
  })

  test('last boundary missing returns empty', () => {
    expect(getSpanUuids(msgs, uid('b'), uid('x'))).toEqual([])
  })

  test('out-of-order boundaries return empty', () => {
    expect(getSpanUuids(msgs, uid('d'), uid('b'))).toEqual([])
  })

  test('full span from first to last', () => {
    expect(getSpanUuids(msgs, uid('a'), uid('e'))).toEqual(['a', 'b', 'c', 'd', 'e'].map(uid))
  })

  test('empty messages returns empty', () => {
    expect(getSpanUuids([], uid('a'), uid('b'))).toEqual([])
  })
})

describe('buildCollapsePlaceholder', () => {
  test('builds valid placeholder string', () => {
    const result = buildCollapsePlaceholder('0000000000000001', 'summarized content')
    expect(result).toBe('<collapsed id="0000000000000001">summarized content</collapsed>')
  })

  test('escapes nothing - raw summary is embedded', () => {
    const result = buildCollapsePlaceholder('42', 'text with <tags> and "quotes"')
    expect(result).toContain('<tags>')
    expect(result).toContain('"quotes"')
  })
})

describe('isCollapsePlaceholder', () => {
  test('detects collapse placeholder system messages', () => {
    const msg = makeSysMsg('<collapsed id="1">summary</collapsed>')
    expect(isCollapsePlaceholder(msg)).toBe(true)
  })

  test('rejects non-system messages', () => {
    const msg = makeMsg('uuid-1')
    expect(isCollapsePlaceholder(msg)).toBe(false)
  })

  test('rejects system messages without collapsed prefix', () => {
    const msg = makeSysMsg('regular system message')
    expect(isCollapsePlaceholder(msg)).toBe(false)
  })

  test('rejects system messages that only happen to contain collapsed word', () => {
    const msg = makeSysMsg('something about a collapsed bridge')
    expect(isCollapsePlaceholder(msg)).toBe(false)
  })
})

describe('isWithinCollapsedSpan', () => {
  const msgs: Message[] = ['a', 'b', 'c', 'd', 'e'].map(makeMsg)

  test('message inside a single span returns true', () => {
    const commits = [{ firstArchivedUuid: uid('b'), lastArchivedUuid: uid('d') }]
    expect(isWithinCollapsedSpan(makeMsg('c'), msgs, commits)).toBe(true)
  })

  test('message at span boundary returns true', () => {
    const commits = [{ firstArchivedUuid: uid('b'), lastArchivedUuid: uid('d') }]
    expect(isWithinCollapsedSpan(makeMsg('b'), msgs, commits)).toBe(true)
    expect(isWithinCollapsedSpan(makeMsg('d'), msgs, commits)).toBe(true)
  })

  test('message outside span returns false', () => {
    const commits = [{ firstArchivedUuid: uid('b'), lastArchivedUuid: uid('d') }]
    expect(isWithinCollapsedSpan(makeMsg('a'), msgs, commits)).toBe(false)
    expect(isWithinCollapsedSpan(makeMsg('e'), msgs, commits)).toBe(false)
  })

  test('message not in array at all returns false', () => {
    const commits = [{ firstArchivedUuid: uid('a'), lastArchivedUuid: uid('e') }]
    expect(isWithinCollapsedSpan(makeMsg('z'), msgs, commits)).toBe(false)
  })

  test('no commits returns false', () => {
    expect(isWithinCollapsedSpan(makeMsg('c'), msgs, [])).toBe(false)
  })

  test('multiple commits - message in second span', () => {
    const commits = [
      { firstArchivedUuid: uid('a'), lastArchivedUuid: uid('a') },
      { firstArchivedUuid: uid('c'), lastArchivedUuid: uid('e') },
    ]
    expect(isWithinCollapsedSpan(makeMsg('d'), msgs, commits)).toBe(true)
    expect(isWithinCollapsedSpan(makeMsg('b'), msgs, commits)).toBe(false)
  })
})

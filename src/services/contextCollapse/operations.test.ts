import { randomUUID } from 'crypto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from '../../types/message.js'

function uid(s: string): UUID {
  return `00000000-0000-4000-8000-${s.padStart(12, '0')}` as UUID
}

function makeUserMsg(id: string): Message {
  return {
    type: 'user',
    uuid: uid(id),
    timestamp: new Date().toISOString(),
    message: { content: 'hello', role: 'user' as const },
  } as unknown as Message
}

function makeAssistantMsg(id: string): Message {
  return {
    type: 'assistant',
    uuid: uid(id),
    timestamp: new Date().toISOString(),
    message: {
      id: randomUUID(),
      model: 'claude-sonnet-4',
      role: 'assistant',
      stop_reason: 'end_turn',
      stop_sequence: '',
      type: 'message',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text' as const, text: 'ok' }],
      context_management: null,
    },
  } as unknown as Message
}

describe('projectView', () => {
  // Reset and rebuild a known commit before EACH test so outcomes never depend
  // on shared module state or test execution order.
  beforeEach(async () => {
    process.env.CLAUDE_CONTEXT_COLLAPSE = '1'
    const idx = await import('./index.js')
    idx.resetContextCollapse()
    idx.initContextCollapse()
    idx.restoreContextCollapseState(
      [
        {
          type: 'marble-origami-commit' as const,
          sessionId: uid('s1'),
          collapseId: '0000000000000001',
          summaryUuid: uid('sum1'),
          summaryContent: '<collapsed id="0000000000000001">test summary</collapsed>',
          summary: 'test summary',
          firstArchivedUuid: uid('a'),
          lastArchivedUuid: uid('b'),
        },
      ],
      undefined,
    )
  })

  afterEach(async () => {
    delete process.env.CLAUDE_CONTEXT_COLLAPSE
    const idx = await import('./index.js')
    idx.resetContextCollapse()
  })

  test('replays commit, replacing span with placeholder', async () => {
    const mod = await import('./operations.js')
    const msgs: Message[] = [makeUserMsg('a'), makeAssistantMsg('b'), makeUserMsg('c')]
    const result = mod.projectView(msgs)

    expect(result.length).toBe(2)
    expect(result[0]!.type).toBe('system')
    expect((result[0]! as any).content).toContain('test summary')
    expect(result[1]!.uuid).toBe(uid('c'))
  })

  test('silently skips missing boundaries', async () => {
    const mod = await import('./operations.js')
    const msgs: Message[] = [makeUserMsg('x'), makeAssistantMsg('y')]
    const result = mod.projectView(msgs)
    expect(result.length).toBe(2)
  })

  test('handles empty messages', async () => {
    const mod = await import('./operations.js')
    const result = mod.projectView([])
    expect(Array.isArray(result)).toBe(true)
  })
})

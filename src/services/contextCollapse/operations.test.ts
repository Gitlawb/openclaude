import { randomUUID } from 'crypto'
import { describe, expect, test } from 'bun:test'
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

// Setup known state once before operations tests.
// All tests in this describe share the same commit log in module state.
describe('projectView', () => {
  // Bootstrap: init and set a known commit
  const ready = (async () => {
    const idx = await import('./index.js')
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
  })()

  test('replays commit, replacing span with placeholder', async () => {
    await ready
    const mod = await import('./operations.js')
    const msgs: Message[] = [makeUserMsg('a'), makeAssistantMsg('b'), makeUserMsg('c')]
    const result = mod.projectView(msgs)

    expect(result.length).toBe(2)
    expect(result[0]!.type).toBe('system')
    expect((result[0]! as any).content).toContain('test summary')
    expect(result[1]!.uuid).toBe(uid('c'))
  })

  test('silently skips missing boundaries', async () => {
    await ready
    const mod = await import('./operations.js')
    const msgs: Message[] = [makeUserMsg('x'), makeAssistantMsg('y')]
    const result = mod.projectView(msgs)
    expect(result.length).toBe(2)
  })

  test('handles empty messages', async () => {
    await ready
    const mod = await import('./operations.js')
    const result = mod.projectView([])
    expect(Array.isArray(result)).toBe(true)
  })
})

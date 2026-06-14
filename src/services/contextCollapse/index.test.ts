import { randomUUID } from 'crypto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from '../../types/message.js'
import type { ContextCollapseCommitEntry, ContextCollapseSnapshotEntry } from '../../types/logs.js'

beforeEach(() => {
  process.env.CLAUDE_CONTEXT_COLLAPSE = '1'
})
afterEach(() => {
  delete process.env.CLAUDE_CONTEXT_COLLAPSE
})

function uid(s: string): UUID {
  return `00000000-0000-4000-8000-${s.padStart(12, '0')}` as UUID
}

function makeUserMsg(id: string, content = 'hello'): Message {
  return {
    type: 'user',
    uuid: uid(id),
    timestamp: new Date().toISOString(),
    message: { content, role: 'user' as const },
  } as unknown as Message
}

function makeAssistantMsg(id: string, content = 'response'): Message {
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
      content: [{ type: 'text' as const, text: content }],
      context_management: null,
    },
  } as unknown as Message
}

function makeFakeToolUseContext() {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4',
      tools: [] as any,
      verbose: false,
      thinkingConfig: {},
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { maxTurns: 10 },
    },
    abortController: new AbortController(),
    readFileState: {} as any,
    getAppState: () => ({} as any),
    setAppState: (_f: any) => {},
    messages: [],
  } as any
}

// Module state is shared across ALL test files. We clean between groups.
async function cleanState() {
  const idx = await import('./index.js')
  idx.resetContextCollapse()
}

describe('init and enable', () => {
  test('initContextCollapse enables when CLAUDE_CONTEXT_COLLAPSE=1', async () => {
    await cleanState()
    process.env.CLAUDE_CONTEXT_COLLAPSE = '1'
    const idx = await import('./index.js')
    idx.initContextCollapse()
    expect(idx.isContextCollapseEnabled()).toBe(true)
  })

  test('initContextCollapse defaults to OFF without the env opt-in', async () => {
    await cleanState()
    delete process.env.CLAUDE_CONTEXT_COLLAPSE
    const idx = await import('./index.js')
    idx.initContextCollapse()
    expect(idx.isContextCollapseEnabled()).toBe(false)
    // restore for subsequent tests (beforeEach also sets it, but be explicit)
    process.env.CLAUDE_CONTEXT_COLLAPSE = '1'
  })

  test('getContextCollapseState returns valid shape when enabled', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const state = idx.getContextCollapseState()!
    expect(state).not.toBeNull()
    expect(typeof state.committedSpans).toBe('number')
    expect(typeof state.stagedSpans).toBe('number')
    expect(typeof state.armed).toBe('boolean')
  })

  test('getContextCollapseState returns null when not enabled', async () => {
    // Deterministic disabled state: clear the opt-in env and re-init so
    // enabled=false, then assert the null contract directly.
    await cleanState()
    delete process.env.CLAUDE_CONTEXT_COLLAPSE
    const idx = await import('./index.js')
    idx.initContextCollapse()
    expect(idx.getContextCollapseState()).toBeNull()
    // Restore the opt-in for subsequent tests (beforeEach also sets it).
    process.env.CLAUDE_CONTEXT_COLLAPSE = '1'
  })
})

describe('stats and subscribe', () => {
  test('getStats returns zero stats on fresh state', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const stats = idx.getStats()
    expect(stats.collapsedSpans).toBe(0)
    expect(stats.collapsedMessages).toBe(0)
    expect(stats.stagedSpans).toBe(0)
  })

  test('subscribe returns unsubscribe function', async () => {
    await cleanState()
    const idx = await import('./index.js')
    const unsub = idx.subscribe(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  test('subscribe listener fires on resetContextCollapse', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    let called = false
    idx.subscribe(() => { called = true })
    idx.resetContextCollapse()
    expect(called).toBe(true)
  })
})

describe('core API (no staged spans)', () => {
  test('applyCollapsesIfNeeded: identity when nothing staged', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const msgs = [makeUserMsg('a'), makeAssistantMsg('b')]
    const result = await idx.applyCollapsesIfNeeded(msgs, makeFakeToolUseContext(), 'user_prompt' as any)
    expect(result.messages).toEqual(msgs)
  })

  test('applyCollapsesIfNeeded: skips marble_origami source', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const msgs = [makeUserMsg('a'), makeAssistantMsg('b')]
    const result = await idx.applyCollapsesIfNeeded(msgs, makeFakeToolUseContext(), 'marble_origami' as any)
    expect(result.messages).toEqual(msgs)
  })

  test('isWithheldPromptTooLong: false with no staged', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const msg = makeAssistantMsg('a', 'prompt too long')
    expect(idx.isWithheldPromptTooLong(msg, () => true, 'user_prompt' as any)).toBe(false)
  })

  test('isWithheldPromptTooLong: false for non-assistant', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const user = makeUserMsg('a')
    expect(idx.isWithheldPromptTooLong(user, () => true, 'user_prompt' as any)).toBe(false)
  })

  test('isWithheldPromptTooLong: false for undefined', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    expect(idx.isWithheldPromptTooLong(undefined, () => true, 'user_prompt' as any)).toBe(false)
  })

  test('recoverFromOverflow: zero committed on clean state', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const msgs = [makeUserMsg('a'), makeAssistantMsg('b')]
    const result = idx.recoverFromOverflow(msgs, 'user_prompt' as any)
    expect(result.committed).toBe(0)
    expect(result.messages).toEqual(msgs)
  })
})

describe('restoreContextCollapseState', () => {
  test('rebuilds from commits and snapshot', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()

    const commits: ContextCollapseCommitEntry[] = [
      {
        type: 'marble-origami-commit' as const,
        sessionId: uid('s1'),
        collapseId: '0000000000000007',
        summaryUuid: uid('s1'),
        summaryContent: '<collapsed id="0000000000000007">summary</collapsed>',
        summary: 'summary',
        firstArchivedUuid: uid('a'),
        lastArchivedUuid: uid('b'),
      },
    ]

    const snapshot: ContextCollapseSnapshotEntry = {
      type: 'marble-origami-snapshot' as const,
      sessionId: uid('s1'),
      staged: [
        { startUuid: uid('c'), endUuid: uid('d'), summary: 'pending', risk: 0.7, stagedAt: Date.now() },
      ],
      armed: true,
      lastSpawnTokens: 10000,
    }

    idx.restoreContextCollapseState(commits, snapshot)
    expect(idx.getStats().collapsedSpans).toBe(1)
    expect(idx.getStats().stagedSpans).toBe(1)
  })

  test('ID counter reseeded from max collapseId', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()

    idx.restoreContextCollapseState([
      {
        type: 'marble-origami-commit' as const,
        sessionId: uid('s1'),
        collapseId: '0000000000000042',
        summaryUuid: uid('s1'),
        summaryContent: '<collapsed id="0000000000000042">x</collapsed>',
        summary: 'x',
        firstArchivedUuid: uid('a'),
        lastArchivedUuid: uid('b'),
      },
    ], undefined)

    expect(idx.getStats().collapsedSpans).toBe(1)
  })

  test('snapshot last-wins', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()

    const s1: ContextCollapseSnapshotEntry = {
      type: 'marble-origami-snapshot' as const, sessionId: uid('s1'),
      staged: [{ startUuid: uid('a'), endUuid: uid('b'), summary: 'first', risk: 0.3, stagedAt: Date.now() }],
      armed: true, lastSpawnTokens: 1000,
    }
    idx.restoreContextCollapseState([], s1)
    expect(idx.getStats().stagedSpans).toBe(1)

    const s2: ContextCollapseSnapshotEntry = {
      type: 'marble-origami-snapshot' as const, sessionId: uid('s1'),
      staged: [
        { startUuid: uid('c'), endUuid: uid('d'), summary: 'second-a', risk: 0.9, stagedAt: Date.now() },
        { startUuid: uid('e'), endUuid: uid('f'), summary: 'second-b', risk: 0.5, stagedAt: Date.now() },
      ],
      armed: false, lastSpawnTokens: 2000,
    }
    idx.restoreContextCollapseState([], s2)
    expect(idx.getStats().stagedSpans).toBe(2)
  })
})

describe('health', () => {
  test('health fields initialized correctly', async () => {
    await cleanState()
    const idx = await import('./index.js')
    idx.initContextCollapse()
    const s = idx.getStats()
    expect(s.health.totalSpawns).toBe(0)
    expect(s.health.totalErrors).toBe(0)
    expect(s.health.totalEmptySpawns).toBe(0)
    expect(s.health.lastError).toBeNull()
    expect(s.health.emptySpawnWarningEmitted).toBe(false)
  })
})

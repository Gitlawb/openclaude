import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'

function uid(s: string): UUID {
  return `00000000-0000-4000-8000-${s.padStart(12, '0')}` as UUID
}

describe('restoreFromEntries', () => {
  // Isolate each test from shared module/env state.
  beforeEach(async () => {
    process.env.CLAUDE_CONTEXT_COLLAPSE = '1'
    const idx = await import('./index.js')
    idx.initContextCollapse()
    idx.resetContextCollapse()
  })

  afterEach(async () => {
    delete process.env.CLAUDE_CONTEXT_COLLAPSE
    const idx = await import('./index.js')
    idx.initContextCollapse()
    idx.resetContextCollapse()
  })

  test('module loads and restoreFromEntries is callable', async () => {
    const mod = await import('./persist.js')
    expect(typeof mod.restoreFromEntries).toBe('function')
  })

  test('restores with empty inputs without error', async () => {
    const mod = await import('./persist.js')
    // First make sure context collapse is initialized
    const idx = await import('./index.js')
    idx.initContextCollapse()

    // restore should not throw
    expect(() => mod.restoreFromEntries([], undefined)).not.toThrow()
  })

  test('restores with commits and snapshot', async () => {
    const mod = await import('./persist.js')
    const idx = await import('./index.js')
    idx.initContextCollapse()

    mod.restoreFromEntries(
      [
        {
          type: 'marble-origami-commit' as const,
          sessionId: uid('s1'),
          collapseId: '0000000000000001',
          summaryUuid: uid('sum1'),
          summaryContent: '<collapsed id="0000000000000001">test</collapsed>',
          summary: 'test',
          firstArchivedUuid: uid('a'),
          lastArchivedUuid: uid('b'),
        },
      ],
      {
        type: 'marble-origami-snapshot' as const,
        sessionId: uid('s1'),
        staged: [
          { startUuid: uid('c'), endUuid: uid('d'), summary: 'pending', risk: 0.5, stagedAt: Date.now() },
        ],
        armed: true,
        lastSpawnTokens: 10000,
      },
    )

    const stats = idx.getStats()
    expect(stats.collapsedSpans).toBe(1)
    expect(stats.stagedSpans).toBe(1)
  })
})

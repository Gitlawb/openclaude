import { describe, expect, test } from 'bun:test'
import { getMemoryDelta } from './memoryDelta.js'

type FakeMsg = {
  type: string
  attachment?: {
    type: string
    addedNames?: string[]
    addedHashes?: string[]
    removedNames?: string[]
  }
}

function priorDelta(
  addedNames: string[],
  addedHashes: string[],
  removedNames: string[] = [],
): FakeMsg {
  return {
    type: 'attachment',
    attachment: {
      type: 'memory_delta',
      addedNames,
      addedHashes,
      removedNames,
    },
  }
}

describe('getMemoryDelta', () => {
  test('returns null when state is empty and nothing was announced', () => {
    expect(getMemoryDelta([], [])).toBeNull()
  })

  test('emits all files on turn 1 (isInitial=true)', () => {
    const delta = getMemoryDelta(
      [
        { path: '/repo/CLAUDE.md', content: 'root rules' },
        { path: '/repo/pkg/CLAUDE.md', content: 'pkg rules' },
      ],
      [],
    )
    expect(delta).not.toBeNull()
    expect(delta!.addedNames).toEqual([
      '/repo/CLAUDE.md',
      '/repo/pkg/CLAUDE.md',
    ])
    expect(delta!.addedContent).toEqual(['root rules', 'pkg rules'])
    expect(delta!.isInitial).toBe(true)
    expect(delta!.removedNames).toEqual([])
  })

  test('two consecutive calls with identical state: second is no-op', () => {
    const first = getMemoryDelta(
      [{ path: '/repo/CLAUDE.md', content: 'same' }],
      [],
    )!
    const history: FakeMsg[] = [
      priorDelta(first.addedNames, first.addedHashes),
    ]
    expect(
      getMemoryDelta(
        [{ path: '/repo/CLAUDE.md', content: 'same' }],
        history,
      ),
    ).toBeNull()
  })

  test('emits only changed content when one file drifts', () => {
    const first = getMemoryDelta(
      [
        { path: '/a/CLAUDE.md', content: 'alpha' },
        { path: '/b/CLAUDE.md', content: 'beta' },
      ],
      [],
    )!
    const history: FakeMsg[] = [
      priorDelta(first.addedNames, first.addedHashes),
    ]
    const delta = getMemoryDelta(
      [
        { path: '/a/CLAUDE.md', content: 'alpha' },
        { path: '/b/CLAUDE.md', content: 'beta CHANGED' },
      ],
      history,
    )
    expect(delta).not.toBeNull()
    expect(delta!.addedNames).toEqual(['/b/CLAUDE.md'])
    expect(delta!.addedContent).toEqual(['beta CHANGED'])
    expect(delta!.removedNames).toEqual([])
    expect(delta!.isInitial).toBe(false)
  })

  test('emits removedNames when a file disappears', () => {
    const first = getMemoryDelta(
      [
        { path: '/a/CLAUDE.md', content: 'alpha' },
        { path: '/b/CLAUDE.md', content: 'beta' },
      ],
      [],
    )!
    const history: FakeMsg[] = [
      priorDelta(first.addedNames, first.addedHashes),
    ]
    const delta = getMemoryDelta(
      [{ path: '/a/CLAUDE.md', content: 'alpha' }],
      history,
    )
    expect(delta).not.toBeNull()
    expect(delta!.addedNames).toEqual([])
    expect(delta!.removedNames).toEqual(['/b/CLAUDE.md'])
  })

  test('regression: reconstructs announced set across multiple prior deltas', () => {
    const t1 = getMemoryDelta(
      [{ path: '/a/CLAUDE.md', content: 'a1' }],
      [],
    )!
    const t2 = getMemoryDelta(
      [
        { path: '/a/CLAUDE.md', content: 'a1' },
        { path: '/b/CLAUDE.md', content: 'b1' },
      ],
      [priorDelta(t1.addedNames, t1.addedHashes)],
    )!
    const history: FakeMsg[] = [
      priorDelta(t1.addedNames, t1.addedHashes),
      priorDelta(t2.addedNames, t2.addedHashes),
    ]
    // Turn 3 with no change — must be no-op.
    expect(
      getMemoryDelta(
        [
          { path: '/a/CLAUDE.md', content: 'a1' },
          { path: '/b/CLAUDE.md', content: 'b1' },
        ],
        history,
      ),
    ).toBeNull()
  })

  test('deterministic output: ordering is stable regardless of input order', () => {
    const a = getMemoryDelta(
      [
        { path: '/z/CLAUDE.md', content: 'z' },
        { path: '/a/CLAUDE.md', content: 'a' },
      ],
      [],
    )!
    expect(a.addedNames).toEqual(['/a/CLAUDE.md', '/z/CLAUDE.md'])
  })

  // Regression guard: `isInitial` must reflect "never announced before",
  // not "currently-tracked set is empty". After a full retraction the
  // tracked set goes to 0 but the session has already seen deltas; a
  // subsequent re-add is NOT initial. Using announced.size here would
  // silently lie on analytics.
  test('isInitial stays false after a full retraction followed by re-add', () => {
    const file = { path: '/pkg/CLAUDE.md', content: 'original' }

    // Turn 1 — initial emit
    const first = getMemoryDelta([file], [])!
    expect(first.isInitial).toBe(true)

    // Turn 2 — remove everything
    const history: FakeMsg[] = [
      priorDelta(first.addedNames, first.addedHashes),
    ]
    const retracted = getMemoryDelta([], history)!
    expect(retracted.removedNames).toEqual(['/pkg/CLAUDE.md'])
    expect(retracted.isInitial).toBe(false) // prior delta existed

    // Turn 3 — re-add the same file after retraction. announced.size == 0
    // at this point, but the session has already emitted 2 memory_delta
    // attachments, so this is NOT initial.
    history.push(
      priorDelta([], [], retracted.removedNames),
    )
    const readded = getMemoryDelta([file], history)!
    expect(readded.addedNames).toEqual(['/pkg/CLAUDE.md'])
    expect(readded.isInitial).toBe(false)
  })
})

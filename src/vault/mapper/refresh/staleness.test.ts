import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  isStale,
  classifyModules,
  computeEdgeHash,
  type ExistingModule,
  type CurrentAnalysis,
} from './staleness.js'

function makeTmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'bridgeai-stale-'))
}

function writeFile(dir: string, name: string, content = 'x'): string {
  const p = path.join(dir, name)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, content, 'utf-8')
  return p
}

function makeExisting(slug: string, opts: Partial<ExistingModule> = {}): ExistingModule {
  return {
    slug,
    sourcePath: `/repo/src/${slug}`,
    lastVerified: '2026-04-10',
    edgeHash: computeEdgeHash([], []),
    ...opts,
  }
}

function makeCurrent(slug: string, files: string[], opts: Partial<CurrentAnalysis> = {}): CurrentAnalysis {
  return {
    slug,
    sourcePath: `/repo/src/${slug}`,
    files,
    dependsOn: [],
    exports: [],
    ...opts,
  }
}

describe('isStale', () => {
  let tmp: string

  beforeEach(() => { tmp = makeTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('no mtime change, same edges → fresh', () => {
    const file = writeFile(tmp, 'a.ts')
    // Set mtime to before lastVerified
    utimesSync(file, new Date('2026-04-09'), new Date('2026-04-09'))

    const existing = makeExisting('mod')
    const current = makeCurrent('mod', [file])

    const result = isStale(existing, current)
    expect(result.stale).toBe(false)
    expect(result.reason).toBe('fresh')
  })

  test('mtime advanced → stale, reason mtime', () => {
    const file = writeFile(tmp, 'a.ts')
    // Set mtime to after lastVerified
    utimesSync(file, new Date('2026-04-12'), new Date('2026-04-12'))

    const existing = makeExisting('mod')
    const current = makeCurrent('mod', [file])

    const result = isStale(existing, current)
    expect(result.stale).toBe(true)
    expect(result.reason).toBe('mtime')
  })

  test('edges changed (imports added) → stale, reason edges', () => {
    const file = writeFile(tmp, 'a.ts')
    utimesSync(file, new Date('2026-04-09'), new Date('2026-04-09'))

    const existing = makeExisting('mod', {
      edgeHash: computeEdgeHash([], ['foo']),
    })
    // Current has a new dependency
    const current = makeCurrent('mod', [file], {
      dependsOn: ['other-mod'],
      exports: ['foo'],
    })

    const result = isStale(existing, current)
    expect(result.stale).toBe(true)
    expect(result.reason).toBe('edges')
  })

  test('files that do not exist are skipped gracefully', () => {
    const existing = makeExisting('mod')
    const current = makeCurrent('mod', ['/nonexistent/file.ts'])

    // No mtime can be computed → null → not stale via mtime
    // Edge hash matches default → fresh
    const result = isStale(existing, current)
    expect(result.stale).toBe(false)
    expect(result.reason).toBe('fresh')
  })
})

describe('classifyModules', () => {
  let tmp: string

  beforeEach(() => { tmp = makeTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('existing fresh → reuse, existing stale → recompute, new → missing', () => {
    const freshFile = writeFile(tmp, 'fresh.ts')
    utimesSync(freshFile, new Date('2026-04-09'), new Date('2026-04-09'))

    const staleFile = writeFile(tmp, 'stale.ts')
    utimesSync(staleFile, new Date('2026-04-12'), new Date('2026-04-12'))

    const existing = [
      makeExisting('fresh-mod'),
      makeExisting('stale-mod'),
    ]
    const current = [
      makeCurrent('fresh-mod', [freshFile]),
      makeCurrent('stale-mod', [staleFile]),
      makeCurrent('new-mod', []),
    ]

    const result = classifyModules(existing, current)
    expect(result.reuse).toEqual(['fresh-mod'])
    expect(result.recompute).toEqual(['stale-mod'])
    expect(result.missing).toEqual(['new-mod'])
  })

  test('all missing when no existing modules', () => {
    const result = classifyModules([], [
      makeCurrent('a', []),
      makeCurrent('b', []),
    ])
    expect(result.missing).toEqual(['a', 'b'])
    expect(result.reuse).toEqual([])
    expect(result.recompute).toEqual([])
  })
})

describe('computeEdgeHash', () => {
  test('same inputs produce same hash regardless of order', () => {
    const h1 = computeEdgeHash(['b', 'a'], ['y', 'x'])
    const h2 = computeEdgeHash(['a', 'b'], ['x', 'y'])
    expect(h1).toBe(h2)
  })

  test('different inputs produce different hashes', () => {
    const h1 = computeEdgeHash(['a'], ['x'])
    const h2 = computeEdgeHash(['a', 'b'], ['x'])
    expect(h1).not.toBe(h2)
  })
})

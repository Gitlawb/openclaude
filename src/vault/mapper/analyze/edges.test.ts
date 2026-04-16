import { describe, test, expect } from 'bun:test'
import { buildEdges, type EdgeResult } from './edges.js'
import type { ModuleCandidate } from '../types.js'
import type { ImportRef } from './extractImports.js'

function candidate(slug: string, sourcePath: string): ModuleCandidate {
  return { slug, sourcePath, files: [], language: 'typescript' }
}

function imp(
  specifier: string,
  fromFile: string,
  resolvedPath: string | null,
  opts: { isTypeOnly?: boolean; isExternal?: boolean } = {},
): ImportRef {
  return {
    specifier,
    fromFile,
    resolvedPath,
    isTypeOnly: opts.isTypeOnly ?? false,
    isExternal: opts.isExternal ?? false,
  }
}

describe('buildEdges', () => {
  test('A imports from B → A.dependsOn includes B; B.dependedBy includes A', () => {
    const candidates = [
      candidate('mod-a', '/repo/src/a'),
      candidate('mod-b', '/repo/src/b'),
    ]
    const importsByModule = new Map([
      ['mod-a', [imp('./b/index.js', '/repo/src/a/main.ts', '/repo/src/b/index.ts')]],
      ['mod-b', []],
    ])

    const result = buildEdges(candidates, importsByModule)

    expect(result.dependsOn.get('mod-a')).toEqual(['mod-b'])
    expect(result.dependedBy.get('mod-b')).toEqual(['mod-a'])
    expect(result.dependsOn.get('mod-b')).toEqual([])
    expect(result.dependedBy.get('mod-a')).toEqual([])
  })

  test('self-import (A imports own file) → no self-loop in dependsOn', () => {
    const candidates = [candidate('mod-a', '/repo/src/a')]
    const importsByModule = new Map([
      ['mod-a', [imp('./utils.js', '/repo/src/a/main.ts', '/repo/src/a/utils.ts')]],
    ])

    const result = buildEdges(candidates, importsByModule)

    expect(result.dependsOn.get('mod-a')).toEqual([])
    expect(result.dependedBy.get('mod-a')).toEqual([])
  })

  test('circular dependency (A↔B) → both edges recorded, cycles detected', () => {
    const candidates = [
      candidate('mod-a', '/repo/src/a'),
      candidate('mod-b', '/repo/src/b'),
    ]
    const importsByModule = new Map([
      ['mod-a', [imp('../b/index.js', '/repo/src/a/main.ts', '/repo/src/b/index.ts')]],
      ['mod-b', [imp('../a/index.js', '/repo/src/b/main.ts', '/repo/src/a/index.ts')]],
    ])

    const result = buildEdges(candidates, importsByModule)

    expect(result.dependsOn.get('mod-a')).toEqual(['mod-b'])
    expect(result.dependsOn.get('mod-b')).toEqual(['mod-a'])
    expect(result.cycles.length).toBeGreaterThanOrEqual(1)
    // Cycle should contain both nodes
    const cycle = result.cycles[0]
    expect(cycle).toContain('mod-a')
    expect(cycle).toContain('mod-b')
  })

  test('external imports land in externalByModule, not in internal edges', () => {
    const candidates = [candidate('mod-a', '/repo/src/a')]
    const importsByModule = new Map([
      [
        'mod-a',
        [
          imp('node:fs', '/repo/src/a/main.ts', null, { isExternal: true }),
          imp('zod', '/repo/src/a/main.ts', null, { isExternal: true }),
          imp('@nestjs/core', '/repo/src/a/main.ts', null, { isExternal: true }),
        ],
      ],
    ])

    const result = buildEdges(candidates, importsByModule)

    expect(result.dependsOn.get('mod-a')).toEqual([])
    expect(result.externalByModule.get('mod-a')).toEqual(['@nestjs/core', 'fs', 'zod'])
  })

  test('import to file not in any candidate → warning, edge dropped', () => {
    const candidates = [candidate('mod-a', '/repo/src/a')]
    const importsByModule = new Map([
      ['mod-a', [imp('./orphan.js', '/repo/src/a/main.ts', '/repo/src/orphan.ts')]],
    ])

    const result = buildEdges(candidates, importsByModule)

    expect(result.dependsOn.get('mod-a')).toEqual([])
    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    expect(result.warnings[0].reason).toBe('resolved-path-not-in-any-module')
  })

  test('multiple modules with complex graph', () => {
    const candidates = [
      candidate('mod-a', '/repo/src/a'),
      candidate('mod-b', '/repo/src/b'),
      candidate('mod-c', '/repo/src/c'),
    ]
    const importsByModule = new Map([
      [
        'mod-a',
        [
          imp('../b/x.js', '/repo/src/a/main.ts', '/repo/src/b/x.ts'),
          imp('../c/y.js', '/repo/src/a/main.ts', '/repo/src/c/y.ts'),
        ],
      ],
      ['mod-b', [imp('../c/y.js', '/repo/src/b/x.ts', '/repo/src/c/y.ts')]],
      ['mod-c', []],
    ])

    const result = buildEdges(candidates, importsByModule)

    expect(result.dependsOn.get('mod-a')).toEqual(['mod-b', 'mod-c'])
    expect(result.dependsOn.get('mod-b')).toEqual(['mod-c'])
    expect(result.dependsOn.get('mod-c')).toEqual([])
    expect(result.dependedBy.get('mod-c')).toEqual(['mod-a', 'mod-b'])
    expect(result.dependedBy.get('mod-b')).toEqual(['mod-a'])
    expect(result.cycles).toHaveLength(0)
  })

  test('duplicate edges from multiple imports are deduped', () => {
    const candidates = [
      candidate('mod-a', '/repo/src/a'),
      candidate('mod-b', '/repo/src/b'),
    ]
    const importsByModule = new Map([
      [
        'mod-a',
        [
          imp('../b/x.js', '/repo/src/a/one.ts', '/repo/src/b/x.ts'),
          imp('../b/y.js', '/repo/src/a/two.ts', '/repo/src/b/y.ts'),
        ],
      ],
      ['mod-b', []],
    ])

    const result = buildEdges(candidates, importsByModule)

    // Should have exactly one edge to mod-b, not two
    expect(result.dependsOn.get('mod-a')).toEqual(['mod-b'])
    expect(result.dependedBy.get('mod-b')).toEqual(['mod-a'])
  })

  test('type-only imports still produce edges', () => {
    const candidates = [
      candidate('mod-a', '/repo/src/a'),
      candidate('mod-b', '/repo/src/b'),
    ]
    const importsByModule = new Map([
      ['mod-a', [imp('../b/types.js', '/repo/src/a/main.ts', '/repo/src/b/types.ts', { isTypeOnly: true })]],
      ['mod-b', []],
    ])

    const result = buildEdges(candidates, importsByModule)

    expect(result.dependsOn.get('mod-a')).toEqual(['mod-b'])
  })
})

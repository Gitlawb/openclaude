import { describe, test, expect } from 'bun:test'
import { archiveMissing, type ExistingModuleRef } from './archive.js'
import type { ModuleCandidate } from '../types.js'

function existing(slug: string, sourcePath: string, folder = 'knowledge'): ExistingModuleRef {
  return { slug, sourcePath, currentFolder: folder }
}

function candidate(slug: string, sourcePath: string): ModuleCandidate {
  return { slug, sourcePath, files: [], language: 'typescript' }
}

describe('archiveMissing', () => {
  test('module with matching candidate → no op', () => {
    const ops = archiveMissing(
      [existing('auth', '/repo/src/auth')],
      [candidate('auth', '/repo/src/auth')],
    )
    expect(ops).toHaveLength(0)
  })

  test('module with no matching candidate → ArchiveOp emitted', () => {
    const ops = archiveMissing(
      [existing('deleted-mod', '/repo/src/deleted')],
      [candidate('auth', '/repo/src/auth')],
    )
    expect(ops).toHaveLength(1)
    expect(ops[0].slug).toBe('deleted-mod')
    expect(ops[0].from).toBe('knowledge/module-deleted-mod.md')
    expect(ops[0].to).toBe('archive/module-deleted-mod.md')
    expect(ops[0].frontmatterPatch.status).toBe('deprecated')
    expect(ops[0].frontmatterPatch.deprecated_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('already-archived modules are skipped (idempotent)', () => {
    const ops = archiveMissing(
      [existing('old-mod', '/repo/src/old', 'archive')],
      [], // no candidates at all
    )
    expect(ops).toHaveLength(0)
  })

  test('mixed: some matching, some missing, some archived', () => {
    const ops = archiveMissing(
      [
        existing('keep', '/repo/src/keep'),
        existing('remove', '/repo/src/remove'),
        existing('already-archived', '/repo/src/gone', 'archive'),
      ],
      [candidate('keep', '/repo/src/keep')],
    )
    expect(ops).toHaveLength(1)
    expect(ops[0].slug).toBe('remove')
  })
})

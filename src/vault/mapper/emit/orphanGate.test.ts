import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runOrphanGate } from './orphanGate.js'

function makeVault(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-orphan-'))
  mkdirSync(path.join(dir, 'knowledge'), { recursive: true })
  mkdirSync(path.join(dir, 'maps'), { recursive: true })
  return dir
}

function writeModule(vault: string, slug: string): void {
  writeFileSync(
    path.join(vault, 'knowledge', `module-${slug}.md`),
    `---\ntitle: ${slug}\ntype: module\n---\n\n# ${slug}\n`,
    'utf-8',
  )
}

function writeMoc(vault: string, name: string, body: string): void {
  writeFileSync(
    path.join(vault, 'maps', `${name}.md`),
    `---\ntitle: ${name}\ntype: moc\nrelated: []\n---\n\n${body}\n`,
    'utf-8',
  )
}

describe('runOrphanGate', () => {
  let vault: string

  beforeEach(() => {
    vault = makeVault()
  })
  afterEach(() => {
    rmSync(vault, { recursive: true, force: true })
  })

  test('all modules linked from MOCs → orphans: [], ok: true', () => {
    writeModule(vault, 'auth')
    writeModule(vault, 'users')
    writeModule(vault, 'config')
    writeMoc(vault, 'moc-core', '- [[module-auth]]\n- [[module-users]]\n- [[module-config]]')

    const result = runOrphanGate(vault)
    expect(result.orphans).toEqual([])
    expect(result.ok).toBe(true)
  })

  test('one module unlinked → orphans contains it, ok: false', () => {
    writeModule(vault, 'auth')
    writeModule(vault, 'orphaned')
    writeMoc(vault, 'moc-core', '- [[module-auth]]')

    const result = runOrphanGate(vault)
    expect(result.orphans).toEqual(['module-orphaned'])
    expect(result.ok).toBe(false)
  })

  test('links in MOC related: frontmatter also count as incoming', () => {
    writeModule(vault, 'utils')
    // Link only via related: frontmatter, not body
    writeFileSync(
      path.join(vault, 'maps', 'moc-tools.md'),
      `---\ntitle: tools\ntype: moc\nrelated: ["[[module-utils]]"]\n---\n\n# Tools\n`,
      'utf-8',
    )

    const result = runOrphanGate(vault)
    expect(result.orphans).toEqual([])
    expect(result.ok).toBe(true)
  })

  test('links from knowledge/ → knowledge/ do NOT count', () => {
    writeModule(vault, 'alpha')
    writeModule(vault, 'beta')
    // beta links to alpha, but from knowledge/ not maps/
    writeFileSync(
      path.join(vault, 'knowledge', 'module-beta.md'),
      `---\ntitle: beta\ntype: module\n---\n\nDepends on [[module-alpha]]\n`,
      'utf-8',
    )
    // No MOC links either module
    writeMoc(vault, 'moc-empty', '# Nothing here')

    const result = runOrphanGate(vault)
    expect(result.orphans).toEqual(['module-alpha', 'module-beta'])
    expect(result.ok).toBe(false)
  })

  test('empty vault returns ok: true, no orphans', () => {
    const result = runOrphanGate(vault)
    expect(result.orphans).toEqual([])
    expect(result.ok).toBe(true)
  })

  test('non-module notes in knowledge/ are ignored', () => {
    // A concept note without any incoming link should not be flagged
    writeFileSync(
      path.join(vault, 'knowledge', 'concept-caching.md'),
      `---\ntitle: caching\ntype: concept\n---\n\n# Caching\n`,
      'utf-8',
    )

    const result = runOrphanGate(vault)
    expect(result.orphans).toEqual([])
    expect(result.ok).toBe(true)
  })
})

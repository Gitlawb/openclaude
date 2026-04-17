import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * PIFA-10: tests for the --add-scope CLI flag handler in
 * `bridgeai vault upgrade`.
 *
 * Strategy: redirect resolveVaultPath via the BRIDGEAI_VAULT_PATH env
 * override, then invoke the command's `call`. Avoids mocking the
 * 200+ exports in bootstrap/state.
 */

let repoRoot: string
let vaultPath: string
let savedEnvVault: string | undefined
let savedCwd: string

function setupTempRepo(): void {
  repoRoot = mkdtempSync(path.join(os.tmpdir(), 'pifa-cli-upgrade-'))
  vaultPath = path.join(repoRoot, '.bridgeai', 'vault')
  mkdirSync(path.join(vaultPath, 'knowledge'), { recursive: true })
  // Seed a note WITHOUT scope so --add-scope has work to do.
  writeFileSync(
    path.join(vaultPath, 'knowledge', 'concept-foo.md'),
    `---\ntitle: Foo\ntype: concept\n---\n# Foo\nbody\n`,
    'utf-8',
  )
}

beforeEach(() => {
  savedCwd = process.cwd()
  setupTempRepo()
  savedEnvVault = process.env.BRIDGEAI_VAULT_PATH
  process.env.BRIDGEAI_VAULT_PATH = vaultPath
  process.chdir(repoRoot)
})

afterEach(() => {
  process.chdir(savedCwd)
  if (savedEnvVault === undefined) delete process.env.BRIDGEAI_VAULT_PATH
  else process.env.BRIDGEAI_VAULT_PATH = savedEnvVault
  rmSync(repoRoot, { recursive: true, force: true })
})

describe('bridgeai vault upgrade --add-scope', () => {
  test('--add-scope short-circuits to scope backfill (notes get scope: project)', async () => {
    const mod = await import('./upgrade.js')
    const command = mod.default
    const { call } = await command.load()
    const result = await call('--add-scope', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('Vault Upgrade — scope backfill')
    expect(result.value).toContain('Notes added (`scope: project` inserted):** 1')
    expect(result.value).toContain('Notes already scoped (untouched):** 0')
  })

  test('without --add-scope, default v1→v2 upgrade path runs (no v1 manifest → not-v1 message)', async () => {
    const mod = await import('./upgrade.js')
    const command = mod.default
    const { call } = await command.load()
    const result = await call('', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    // Default path produces the v1→v2 header (NOT the scope-backfill header).
    expect(result.value).toContain('## Vault Upgrade')
    expect(result.value).not.toContain('scope backfill')
  })
})

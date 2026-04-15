import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { upgradeVault, inferNoteType } from './upgrade'
import { bootstrapVault } from './scaffold'
import { saveVaultManifest } from './config'
import type { VaultConfig, VaultManifest } from './types'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-test-'))
  mkdirSync(join(root, '.git'), { recursive: true })
  return root
}

function makeConfig(repoRoot: string): VaultConfig {
  return {
    vaultPath: join(repoRoot, '.bridgeai', 'vault'),
    provider: 'generic',
    projectName: 'test-project',
    projectRoot: repoRoot,
  }
}

/** Build a v1-shaped vault fixture: manifest.json + flat `.md` files at root. */
function seedV1Vault(cfg: VaultConfig, docs: Array<{ name: string; body: string }>): void {
  mkdirSync(cfg.vaultPath, { recursive: true })
  const manifest: VaultManifest = {
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    provider: cfg.provider,
    docs: docs.map((d) => d.name),
  }
  saveVaultManifest(cfg.vaultPath, manifest)
  for (const d of docs) {
    writeFileSync(join(cfg.vaultPath, d.name), d.body, 'utf-8')
  }
}

describe('upgradeVault', () => {
  let repoRoot: string
  let cfg: VaultConfig

  beforeEach(() => {
    repoRoot = makeRepo()
    cfg = makeConfig(repoRoot)
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  test('v1 → v2 transform: moves flat docs under knowledge/, preserves manifest, logs event', async () => {
    seedV1Vault(cfg, [
      { name: 'overview.md', body: '# Overview\n\nProject overview doc.\n' },
      { name: 'architecture.md', body: '# Architecture\n\nHow we structure things.\n' },
      { name: 'testing.md', body: '# Testing\n\nHow we test.\n' },
    ])

    const result = await upgradeVault(cfg)

    expect(result.ok).toBe(true)
    expect(result.shape).toBe('v1')
    expect(result.notesMoved).toBe(3)

    // v2 folder tree exists
    expect(existsSync(join(cfg.vaultPath, '_conventions.md'))).toBe(true)
    expect(existsSync(join(cfg.vaultPath, 'knowledge'))).toBe(true)
    expect(existsSync(join(cfg.vaultPath, 'meta', 'templates'))).toBe(true)

    // All 3 docs now live under knowledge/ with concept- prefix
    expect(existsSync(join(cfg.vaultPath, 'knowledge', 'concept-overview.md'))).toBe(true)
    expect(existsSync(join(cfg.vaultPath, 'knowledge', 'concept-architecture.md'))).toBe(true)
    expect(existsSync(join(cfg.vaultPath, 'knowledge', 'concept-testing.md'))).toBe(true)

    // Flat docs removed from vault root
    expect(existsSync(join(cfg.vaultPath, 'overview.md'))).toBe(false)
    expect(existsSync(join(cfg.vaultPath, 'architecture.md'))).toBe(false)
    expect(existsSync(join(cfg.vaultPath, 'testing.md'))).toBe(false)

    // manifest.json preserved
    expect(existsSync(join(cfg.vaultPath, 'manifest.json'))).toBe(true)

    // _log.md has a vault-upgraded entry
    const log = readFileSync(join(cfg.vaultPath, '_log.md'), 'utf-8')
    expect(log).toContain('vault-upgraded')
    expect(log).toContain('moved=3')
  })

  test('idempotent on v2: returns no-op result', async () => {
    await bootstrapVault(cfg, { gitignore: false })
    const result = await upgradeVault(cfg)
    expect(result.ok).toBe(true)
    expect(result.shape).toBe('v2')
    expect(result.notesMoved).toBe(0)
    expect(result.message).toMatch(/v2/i)
  })

  test('no-op on none: empty vault directory', async () => {
    // Do not create the vault path at all.
    const result = await upgradeVault(cfg)
    expect(result.ok).toBe(false)
    expect(result.shape).toBe('none')
    expect(existsSync(cfg.vaultPath)).toBe(false)
  })

  test('default frontmatter: v1 doc without frontmatter gets filled and passes validation', async () => {
    seedV1Vault(cfg, [
      { name: 'raw-note.md', body: 'Some plain body line.\n\nMore details.\n' },
    ])

    const result = await upgradeVault(cfg)
    expect(result.ok).toBe(true)
    expect(result.notesMoved).toBe(1)
    expect(result.failures ?? []).toEqual([])

    const written = readFileSync(
      join(cfg.vaultPath, 'knowledge', 'concept-raw-note.md'),
      'utf-8',
    )
    expect(written.startsWith('---\n')).toBe(true)
    expect(written).toContain('title:')
    expect(written).toContain('type: concept')
    expect(written).toContain('status: active')
    expect(written).toContain('confidence: medium')
    expect(written).toContain('created:')
    expect(written).toContain('updated:')
    expect(written).toContain('summary:')
    expect(written).toMatch(/tags:/)
  })

  test('inferNoteType: source path resolving under projectRoot → module', () => {
    // Create a real source file under the project root
    mkdirSync(join(repoRoot, 'src', 'lib'), { recursive: true })
    writeFileSync(join(repoRoot, 'src', 'lib', 'foo.ts'), 'export const foo = 1\n')

    const t = inferNoteType('docs/foo.md', { source_path: 'src/lib/foo.ts' }, repoRoot)
    expect(t).toBe('module')
  })

  test('inferNoteType: no source path or non-existent path → concept', () => {
    const withoutSource = inferNoteType('docs/concept.md', {}, repoRoot)
    expect(withoutSource).toBe('concept')

    const withBadSource = inferNoteType(
      'docs/concept.md',
      { source_path: 'src/does/not/exist.ts' },
      repoRoot,
    )
    expect(withBadSource).toBe('concept')
  })

  test('_index.md regenerated from manifest with link to every moved doc', async () => {
    seedV1Vault(cfg, [
      { name: 'alpha.md', body: '# Alpha\n\nA doc.\n' },
      { name: 'beta.md', body: '# Beta\n\nAnother.\n' },
    ])

    await upgradeVault(cfg)

    const index = readFileSync(join(cfg.vaultPath, '_index.md'), 'utf-8')
    expect(index).toContain('concept-alpha')
    expect(index).toContain('concept-beta')
  })
})

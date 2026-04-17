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
import { upgradeVault, inferNoteType, addScopeToVault } from './upgrade'
import { bootstrapVault } from './scaffold'
import { saveVaultManifest } from './config'
import type { VaultConfig, VaultManifest } from './types'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-test-'))
  mkdirSync(join(root, '.git'), { recursive: true })
  return root
}

function makeConfig(repoRoot: string): VaultConfig {
  const vaultPath = join(repoRoot, '.bridgeai', 'vault')
  return {
    local: { path: vaultPath },
    global: null,
    vaultPath,
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

describe('addScopeToVault (PIFA-10..12)', () => {
  let repoRoot: string
  let cfg: VaultConfig

  beforeEach(async () => {
    repoRoot = makeRepo()
    cfg = makeConfig(repoRoot)
    await bootstrapVault(cfg, { gitignore: false })
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  function seedNote(folder: string, filename: string, fmLines: string[], body: string): string {
    const dir = join(cfg.local.path, folder)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${filename}.md`)
    const content = `---\n${fmLines.join('\n')}\n---\n${body}`
    writeFileSync(file, content, 'utf-8')
    return file
  }

  test('inserts scope: project after type: line for notes missing scope; bodies byte-identical', () => {
    const body = 'BODY-MARKER\nmore body content\nfinal line\n'
    const f1 = seedNote('knowledge', 'concept-alpha', ['title: Alpha', 'type: concept'], body)
    const f2 = seedNote('knowledge', 'concept-beta', ['title: Beta', 'type: concept'], body)

    const r = addScopeToVault(cfg)
    expect(r.notesAdded).toBe(2)
    expect(r.notesUntouched).toBe(0)
    expect(r.notesSkipped).toBe(0)

    const after1 = readFileSync(f1, 'utf-8')
    expect(after1).toContain('type: concept\nscope: project')
    // Body byte-identical (after the closing fence + newline).
    expect(after1.endsWith(body)).toBe(true)

    const after2 = readFileSync(f2, 'utf-8')
    expect(after2).toContain('scope: project')
  })

  test('notes with explicit scope (project or global) are left untouched', () => {
    const f1 = seedNote('knowledge', 'concept-with-scope', ['title: WithScope', 'type: concept', 'scope: project'], 'body\n')
    const f2 = seedNote('knowledge', 'concept-with-global', ['title: Global', 'type: concept', 'scope: global'], 'body\n')
    const before1 = readFileSync(f1, 'utf-8')
    const before2 = readFileSync(f2, 'utf-8')

    const r = addScopeToVault(cfg)
    expect(r.notesAdded).toBe(0)
    expect(r.notesUntouched).toBe(2)

    expect(readFileSync(f1, 'utf-8')).toBe(before1)
    expect(readFileSync(f2, 'utf-8')).toBe(before2)
  })

  test('idempotent: second run on same vault is a no-op (notesAdded=0, no extra log entry)', () => {
    seedNote('knowledge', 'concept-idem', ['title: I', 'type: concept'], 'body\n')

    const first = addScopeToVault(cfg)
    expect(first.notesAdded).toBe(1)

    const logBefore = readFileSync(join(cfg.local.path, '_log.md'), 'utf-8')

    const second = addScopeToVault(cfg)
    expect(second.notesAdded).toBe(0)
    expect(second.notesUntouched).toBe(1)

    const logAfter = readFileSync(join(cfg.local.path, '_log.md'), 'utf-8')
    expect(logAfter).toBe(logBefore)
  })

  test('malformed frontmatter (no fences) is skipped and logged', () => {
    const dir = join(cfg.local.path, 'knowledge')
    mkdirSync(dir, { recursive: true })
    const broken = join(dir, 'concept-broken.md')
    writeFileSync(broken, '# Just markdown, no frontmatter at all\n', 'utf-8')

    const r = addScopeToVault(cfg)
    expect(r.notesSkipped).toBe(1)
    expect(r.skippedFiles[0]).toContain('concept-broken')

    const log = readFileSync(join(cfg.local.path, '_log.md'), 'utf-8')
    expect(log).toContain('upgrade-skipped')
    expect(log).toContain('no-frontmatter-fence')
    // No vault-upgrade entry because nothing was added.
    expect(log).not.toContain('vault-upgrade: scope-added')
  })

  test('walks all 6 note folders, not just knowledge/', () => {
    seedNote('knowledge', 'concept-k', ['title: K', 'type: concept'], 'body\n')
    seedNote('decisions', 'adr-0001-foo', ['title: D', 'type: decision'], 'body\n')
    seedNote('archive', 'concept-old', ['title: O', 'type: concept'], 'body\n')

    const r = addScopeToVault(cfg)
    expect(r.notesAdded).toBe(3)
  })
})

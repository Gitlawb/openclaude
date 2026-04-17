import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  bootstrapVault,
  detectVaultShape,
  isVaultV2Bootstrapped,
  regenerateConventions,
} from './scaffold'
import {
  CONVENTIONS_MD_DEFAULT,
  TEMPLATES,
  NOTE_TYPES,
} from './conventions/defaults'
import type { VaultConfig } from './types'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-test-'))
  // Minimal .git dir so findGitRoot finds it.
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

describe('scaffold.bootstrapVault', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = makeRepo()
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  test('creates full VAULT-SCHEMA.md §2 tree: all top-level files and subfolder indexes', async () => {
    const cfg = makeConfig(repoRoot)
    const result = await bootstrapVault(cfg, { gitignore: false })
    const vp = cfg.vaultPath

    // Top-level files
    expect(existsSync(join(vp, '_index.md'))).toBe(true)
    expect(existsSync(join(vp, '_conventions.md'))).toBe(true)
    expect(existsSync(join(vp, '_log.md'))).toBe(true)

    // Subfolder _index.md
    const subfolders = [
      'knowledge',
      'maps',
      'decisions',
      'flows',
      'incidents',
      'archive',
    ]
    for (const f of subfolders) {
      expect(existsSync(join(vp, f, '_index.md'))).toBe(true)
    }

    // meta/templates dir
    expect(existsSync(join(vp, 'meta', 'templates'))).toBe(true)

    // _conventions.md content matches default
    expect(readFileSync(join(vp, '_conventions.md'), 'utf-8')).toBe(
      CONVENTIONS_MD_DEFAULT,
    )

    expect(result.vaultPath).toBe(vp)
    expect(result.filesCreated.length).toBeGreaterThan(0)
    expect(result.gitignoreUpdated).toBe(false)
  })

  test('_log.md is seeded with a bootstrap entry tagged source: code-analysis', async () => {
    const cfg = makeConfig(repoRoot)
    await bootstrapVault(cfg, { gitignore: false })

    const logContent = readFileSync(join(cfg.vaultPath, '_log.md'), 'utf-8')
    expect(logContent).toContain('bootstrap')
    expect(logContent).toContain('source: code-analysis')
    // ISO date pattern
    expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test('meta/templates has one file per NoteType (6 files)', async () => {
    const cfg = makeConfig(repoRoot)
    await bootstrapVault(cfg, { gitignore: false })

    for (const type of NOTE_TYPES) {
      const p = join(cfg.vaultPath, 'meta', 'templates', `${type}.md`)
      expect(existsSync(p)).toBe(true)
      expect(readFileSync(p, 'utf-8')).toBe(TEMPLATES[type])
    }
    expect(NOTE_TYPES.length).toBe(6)
  })

  test('is idempotent: second call preserves pre-existing _conventions.md content', async () => {
    const cfg = makeConfig(repoRoot)
    await bootstrapVault(cfg, { gitignore: false })

    // Overwrite _conventions.md with sentinel content.
    const sentinel = '# Custom user edits - do not overwrite\n'
    writeFileSync(join(cfg.vaultPath, '_conventions.md'), sentinel, 'utf-8')

    const result2 = await bootstrapVault(cfg, { gitignore: false })
    expect(readFileSync(join(cfg.vaultPath, '_conventions.md'), 'utf-8')).toBe(
      sentinel,
    )
    // No files created on a fully-bootstrapped idempotent run.
    expect(result2.filesCreated).toEqual([])
  })

  test('gitignore: true adds .bridgeai/ to <repoRoot>/.gitignore', async () => {
    const cfg = makeConfig(repoRoot)
    const result = await bootstrapVault(cfg, { gitignore: true })

    const gi = join(repoRoot, '.gitignore')
    expect(existsSync(gi)).toBe(true)
    expect(readFileSync(gi, 'utf-8')).toContain('.bridgeai/')
    expect(result.gitignoreUpdated).toBe(true)
  })

  test('gitignore: false does not create or touch .gitignore', async () => {
    const cfg = makeConfig(repoRoot)
    const result = await bootstrapVault(cfg, { gitignore: false })

    const gi = join(repoRoot, '.gitignore')
    expect(existsSync(gi)).toBe(false)
    expect(result.gitignoreUpdated).toBe(false)
  })

  test('throws when outside a git repository (no .git)', async () => {
    // Fresh tmpdir with NO .git
    const nonGit = mkdtempSync(join(tmpdir(), 'scaffold-nogit-'))
    try {
      const cfg = makeConfig(nonGit)
      // Remove the .git dir created by makeConfig? No — makeConfig doesn't create one.
      // But makeRepo did create it; here we used mkdtempSync directly so no .git.
      await expect(bootstrapVault(cfg, { gitignore: false })).rejects.toThrow(
        /outside a git repository/,
      )
    } finally {
      rmSync(nonGit, { recursive: true, force: true })
    }
  })
})

describe('scaffold.detectVaultShape', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = makeRepo()
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  test('returns "none" for non-existent dir', () => {
    expect(detectVaultShape(join(repoRoot, 'does-not-exist'))).toBe('none')
  })

  test('returns "v1" when only manifest.json present', () => {
    const vp = join(repoRoot, 'vault')
    mkdirSync(vp, { recursive: true })
    writeFileSync(join(vp, 'manifest.json'), '{}', 'utf-8')
    expect(detectVaultShape(vp)).toBe('v1')
  })

  test('returns "v2" after bootstrapVault', async () => {
    const cfg = makeConfig(repoRoot)
    await bootstrapVault(cfg, { gitignore: false })
    expect(detectVaultShape(cfg.vaultPath)).toBe('v2')
    expect(isVaultV2Bootstrapped(cfg.vaultPath)).toBe(true)
  })
})

describe('scaffold.regenerateConventions', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = makeRepo()
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  test('rewrites conventions + templates, appends log entry, leaves notes untouched', async () => {
    const cfg = makeConfig(repoRoot)
    await bootstrapVault(cfg, { gitignore: false })

    // Seed a note and tamper with conventions.
    const notePath = join(cfg.vaultPath, 'knowledge', 'concept-foo.md')
    const noteBody = '---\ntitle: "foo"\n---\n\n# foo\n\nSeed content.'
    writeFileSync(notePath, noteBody, 'utf-8')

    // Tamper with conventions + one template
    writeFileSync(join(cfg.vaultPath, '_conventions.md'), 'TAMPERED', 'utf-8')
    writeFileSync(
      join(cfg.vaultPath, 'meta', 'templates', 'module.md'),
      'TAMPERED',
      'utf-8',
    )

    const logBefore = readFileSync(join(cfg.vaultPath, '_log.md'), 'utf-8')

    const result = await regenerateConventions(cfg)

    // Conventions + templates restored
    expect(readFileSync(join(cfg.vaultPath, '_conventions.md'), 'utf-8')).toBe(
      CONVENTIONS_MD_DEFAULT,
    )
    expect(
      readFileSync(join(cfg.vaultPath, 'meta', 'templates', 'module.md'), 'utf-8'),
    ).toBe(TEMPLATES.module)

    // Note untouched
    expect(readFileSync(notePath, 'utf-8')).toBe(noteBody)

    // Log appended
    const logAfter = readFileSync(join(cfg.vaultPath, '_log.md'), 'utf-8')
    expect(logAfter.length).toBeGreaterThan(logBefore.length)
    expect(logAfter).toContain('conventions-regenerated')
    expect(logAfter).toContain('source: code-analysis')

    expect(result.filesWritten.length).toBeGreaterThanOrEqual(
      1 + NOTE_TYPES.length,
    )
  })
})

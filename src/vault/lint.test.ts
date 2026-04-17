import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  utimesSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { bootstrapVault } from './scaffold'
import { lintVault } from './lint'
import { serializeFrontmatter } from '../utils/yamlFrontmatter'
import type { VaultConfig } from './types'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-test-'))
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

/** Seed a valid concept note at <folder>/<filename>.md, with optional frontmatter overrides and body. */
function seedNote(
  vaultPath: string,
  folder: string,
  filename: string,
  overrides: Record<string, unknown> = {},
  body = 'Some body text.\n',
): string {
  const fm: Record<string, unknown> = {
    title: filename,
    type: 'concept',
    tags: ['code/architecture', 'code/testing', 'domain/auth'],
    status: 'draft',
    created: '2026-04-15',
    updated: '2026-04-15',
    confidence: 'medium',
    summary: `Summary for ${filename}.`,
    ...overrides,
  }
  const content = `${serializeFrontmatter(fm)}# ${filename}\n\n${body}`
  const full = join(vaultPath, folder, `${filename}.md`)
  mkdirSync(join(vaultPath, folder), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return full
}

describe('lintVault', () => {
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

  test('clean post-bootstrap vault with no notes → no issues', async () => {
    const result = await lintVault(cfg)
    expect(result.issues).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(result.fixed).toEqual([])
  })

  test('orphan detection: note A is not linked by anything → one orphan for A', async () => {
    // B is linked from A; nothing links to A → A is orphan.
    // B is linked → not orphan.
    seedNote(cfg.vaultPath, 'knowledge', 'concept-alpha', {}, 'Links to [[concept-beta]].\n')
    seedNote(cfg.vaultPath, 'knowledge', 'concept-beta')
    const result = await lintVault(cfg)
    const orphans = result.issues.filter((i) => i.kind === 'orphan')
    expect(orphans.length).toBe(1)
    expect(orphans[0].file).toContain('concept-alpha')
    expect(result.exitCode).toBe(1)
  })

  test('hallucinated link in body → one hallucinated-link issue', async () => {
    // Seed a peer so the note is not also orphan-targeted, then add a link to a ghost.
    seedNote(cfg.vaultPath, 'knowledge', 'concept-host', {}, 'See [[does-not-exist]] and [[concept-peer]].\n')
    seedNote(cfg.vaultPath, 'knowledge', 'concept-peer', {}, 'Links to [[concept-host]].\n')
    const result = await lintVault(cfg)
    const hall = result.issues.filter((i) => i.kind === 'hallucinated-link')
    expect(hall.length).toBe(1)
    expect(hall[0].detail).toContain('does-not-exist')
  })

  test('frontmatter violation: missing type → one frontmatter issue', async () => {
    // Build without `type` field.
    const fm: Record<string, unknown> = {
      title: 'concept-bad',
      tags: ['code/architecture', 'code/testing', 'domain/auth'],
      status: 'draft',
      created: '2026-04-15',
      updated: '2026-04-15',
      confidence: 'medium',
      summary: 'x',
    }
    const content = `${serializeFrontmatter(fm)}# concept-bad\n\nbody\n`
    mkdirSync(join(cfg.vaultPath, 'knowledge'), { recursive: true })
    writeFileSync(
      join(cfg.vaultPath, 'knowledge', 'concept-bad.md'),
      content,
      'utf-8',
    )
    const result = await lintVault(cfg)
    const fmIssues = result.issues.filter(
      (i) => i.kind === 'frontmatter' && i.file.includes('concept-bad'),
    )
    expect(fmIssues.length).toBeGreaterThanOrEqual(1)
    expect(result.exitCode).toBe(1)
  })

  test('tag taxonomy violation: tag outside approved prefixes → one tag issue', async () => {
    seedNote(cfg.vaultPath, 'knowledge', 'concept-tagbad', {
      tags: ['random-unprefixed', 'code/testing', 'domain/auth'],
    })
    const result = await lintVault(cfg)
    const tagIssues = result.issues.filter(
      (i) => i.kind === 'tag' && i.file.includes('concept-tagbad'),
    )
    expect(tagIssues.length).toBeGreaterThanOrEqual(1)
  })

  test('missing _index.md → missing-index issue', async () => {
    rmSync(join(cfg.vaultPath, 'knowledge', '_index.md'))
    const result = await lintVault(cfg)
    const missing = result.issues.filter((i) => i.kind === 'missing-index')
    expect(missing.length).toBe(1)
    expect(missing[0].file).toBe('knowledge/_index.md')
    expect(missing[0].autofixable).toBe(true)
  })

  test('--fix regenerates missing _index.md and clears the issue', async () => {
    rmSync(join(cfg.vaultPath, 'knowledge', '_index.md'))
    const result = await lintVault(cfg, { fix: true })
    expect(result.fixed).toContain('knowledge/_index.md')
    expect(existsSync(join(cfg.vaultPath, 'knowledge', '_index.md'))).toBe(true)
    const missing = result.issues.filter((i) => i.kind === 'missing-index')
    expect(missing.length).toBe(0)
  })

  test('stale note: source mtime newer than last_verified → one stale issue', async () => {
    // Create source file under projectRoot.
    const srcRel = 'src-file.ts'
    const srcAbs = join(repoRoot, srcRel)
    writeFileSync(srcAbs, '// code\n', 'utf-8')

    // Seed a note pointing at it, with last_verified from 2025.
    seedNote(
      cfg.vaultPath,
      'knowledge',
      'module-src',
      {
        type: 'module',
        source_path: srcRel,
        last_verified: '2025-01-01',
      },
      'Covers the [[module-src]] source.\n',
    )

    // Bump source mtime to present.
    const now = new Date()
    utimesSync(srcAbs, now, now)

    const result = await lintVault(cfg)
    const stale = result.issues.filter((i) => i.kind === 'stale')
    expect(stale.length).toBe(1)
    expect(stale[0].file).toContain('module-src')
  })

  test('duplicate filename across folders → one duplicate issue', async () => {
    seedNote(cfg.vaultPath, 'knowledge', 'concept-dup')
    seedNote(cfg.vaultPath, 'archive', 'concept-dup')
    const result = await lintVault(cfg)
    const dup = result.issues.filter((i) => i.kind === 'duplicate')
    expect(dup.length).toBeGreaterThanOrEqual(1)
    expect(dup[0].detail).toContain('concept-dup')
  })

  test('LintResult is JSON-serializable', async () => {
    seedNote(cfg.vaultPath, 'knowledge', 'concept-alpha', {}, 'See [[ghost]].\n')
    const result = await lintVault(cfg)
    // Round-trip.
    const json = JSON.stringify(result)
    const back = JSON.parse(json)
    expect(back.issues.length).toBe(result.issues.length)
    expect(back.exitCode).toBe(result.exitCode)
  })
})

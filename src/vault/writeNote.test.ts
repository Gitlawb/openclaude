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
import { bootstrapVault } from './scaffold'
import { loadConventions, writeNote } from './writeNote'
import type { NoteDraft } from './conventions/validator'
import type { VaultConfig } from './types'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'writenote-test-'))
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

function validConceptDraft(overrides: Partial<NoteDraft> = {}): NoteDraft {
  return {
    filename: 'concept-foo',
    folder: 'knowledge',
    frontmatter: {
      title: 'Foo',
      type: 'concept',
      tags: ['code/architecture', 'code/testing', 'domain/auth'],
      status: 'draft',
      created: '2026-04-15',
      updated: '2026-04-15',
      confidence: 'medium',
      summary: 'A foo concept.',
    },
    body: '# Foo\n\nSome body text.\n',
    ...overrides,
  }
}

describe('writeNote', () => {
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

  test('valid draft writes file at correct folder with canonical frontmatter + body', async () => {
    const draft = validConceptDraft()
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.path).toBe('knowledge/concept-foo.md')
    const full = readFileSync(
      join(cfg.vaultPath, 'knowledge', 'concept-foo.md'),
      'utf-8',
    )
    expect(full.startsWith('---\n')).toBe(true)
    expect(full).toContain('title: Foo')
    expect(full).toContain('type: concept')
    expect(full).toContain('# Foo')
  })

  test('missing required field → violation, no file created', async () => {
    const draft = validConceptDraft()
    delete draft.frontmatter.type
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(
      result.violations.some((v) => v.rule === 'required-field-missing'),
    ).toBe(true)
    expect(
      existsSync(join(cfg.vaultPath, 'knowledge', 'concept-foo.md')),
    ).toBe(false)
  })

  test('hallucinated WikiLink in body → violation, no file created', async () => {
    const draft = validConceptDraft({
      body: '# Foo\n\nSee [[nonexistent-note]] for details.\n',
    })
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(
      result.violations.some(
        (v) => v.rule === 'hallucinated-link' && v.got === 'nonexistent-note',
      ),
    ).toBe(true)
    expect(
      existsSync(join(cfg.vaultPath, 'knowledge', 'concept-foo.md')),
    ).toBe(false)
  })

  test('hallucinated WikiLink in `related` frontmatter → same rule fires', async () => {
    const draft = validConceptDraft({
      frontmatter: {
        ...validConceptDraft().frontmatter,
        related: ['[[ghost-note]]'],
      },
    })
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(
      result.violations.some(
        (v) =>
          v.rule === 'hallucinated-link' &&
          v.field === 'related' &&
          v.got === 'ghost-note',
      ),
    ).toBe(true)
  })

  test('_pendingLinks escape hatch satisfies otherwise-missing target, not serialized', async () => {
    const draft = validConceptDraft({
      body: '# Foo\n\nLinks to [[batch-peer]].\n',
      frontmatter: {
        ...validConceptDraft().frontmatter,
        _pendingLinks: ['batch-peer'],
      },
    })
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const full = readFileSync(
      join(cfg.vaultPath, 'knowledge', 'concept-foo.md'),
      'utf-8',
    )
    expect(full).not.toContain('_pendingLinks')
    expect(full).not.toContain('batch-peer:')
  })

  test('zero-incoming-link first-note case succeeds with orphan-warning in _log.md', async () => {
    const draft = validConceptDraft()
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(true)
    const logContent = readFileSync(
      join(cfg.vaultPath, '_log.md'),
      'utf-8',
    )
    expect(logContent).toContain('orphan-warning')
    expect(logContent).toContain('knowledge/concept-foo.md')
  })

  test('_conventions.md missing at call time → default written + conventions-regenerated log', async () => {
    rmSync(join(cfg.vaultPath, '_conventions.md'))
    const logBefore = readFileSync(join(cfg.vaultPath, '_log.md'), 'utf-8')
    const schema = loadConventions(cfg.vaultPath)
    expect(schema.schemaVersion).toBe('1.0.0')
    expect(existsSync(join(cfg.vaultPath, '_conventions.md'))).toBe(true)
    const logAfter = readFileSync(join(cfg.vaultPath, '_log.md'), 'utf-8')
    expect(logAfter.length).toBeGreaterThan(logBefore.length)
    expect(logAfter).toContain('conventions-regenerated')

    // Write also proceeds
    const result = await writeNote(cfg, validConceptDraft())
    expect(result.ok).toBe(true)
  })

  test('duplicate filename across any note folder → violation', async () => {
    // Seed a file with the same basename in a different note folder.
    const collisionPath = join(
      cfg.vaultPath,
      'archive',
      'concept-foo.md',
    )
    mkdirSync(join(cfg.vaultPath, 'archive'), { recursive: true })
    writeFileSync(collisionPath, '# existing\n', 'utf-8')

    const result = await writeNote(cfg, validConceptDraft())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(
      result.violations.some(
        (v) => v.rule === 'duplicate' && v.field === 'filename',
      ),
    ).toBe(true)
  })
})

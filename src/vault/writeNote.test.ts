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

describe('writeNote — scope dispatch (PIFA-02..04)', () => {
  let repoRoot: string
  let cfg: VaultConfig
  let globalRoot: string

  beforeEach(async () => {
    repoRoot = makeRepo()
    cfg = makeConfig(repoRoot)
    globalRoot = mkdtempSync(join(tmpdir(), 'writenote-global-'))
    await bootstrapVault(cfg, { gitignore: false })
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
    rmSync(globalRoot, { recursive: true, force: true })
  })

  test('missing scope defaults to project and writes to local vault', async () => {
    const draft = validConceptDraft()
    delete draft.frontmatter.scope
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      existsSync(join(cfg.local.path, 'knowledge', 'concept-foo.md')),
    ).toBe(true)
    // The default propagates into the serialized frontmatter.
    const content = readFileSync(
      join(cfg.local.path, 'knowledge', 'concept-foo.md'),
      'utf-8',
    )
    expect(content).toContain('scope: project')
  })

  test('explicit scope: project writes to local vault', async () => {
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'project' },
    })
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(true)
    expect(
      existsSync(join(cfg.local.path, 'knowledge', 'concept-foo.md')),
    ).toBe(true)
  })

  test('scope: global with cfg.global=null returns no-global-vault-configured violation, no fs mutation', async () => {
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'global' },
    })
    const result = await writeNote(cfg, draft)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.violations[0]?.rule).toBe('no-global-vault-configured')
    expect(result.violations[0]?.field).toBe('scope')
    // No file in either vault.
    expect(
      existsSync(join(cfg.local.path, 'knowledge', 'concept-foo.md')),
    ).toBe(false)
    expect(
      existsSync(join(globalRoot, 'knowledge', 'concept-foo.md')),
    ).toBe(false)
  })

  test('scope: global with configured global vault writes to global vault', async () => {
    // Bootstrap the global vault so its conventions exist.
    const globalCfg: VaultConfig = {
      ...cfg,
      local: { path: globalRoot },
      vaultPath: globalRoot,
    }
    await bootstrapVault(globalCfg, { gitignore: false })

    const cfgWithGlobal: VaultConfig = {
      ...cfg,
      global: { path: globalRoot },
    }
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'global' },
    })
    const result = await writeNote(cfgWithGlobal, draft)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // File appears under global vault, NOT local vault.
    expect(existsSync(join(globalRoot, 'knowledge', 'concept-foo.md'))).toBe(
      true,
    )
    expect(
      existsSync(join(cfg.local.path, 'knowledge', 'concept-foo.md')),
    ).toBe(false)
  })

  test('per-vault conventions are loaded — global validator runs against global _conventions.md', async () => {
    // Set up a global vault with a stricter rule by writing a different
    // _conventions.md. Easiest proof: write the same draft and verify the
    // file lands in the global vault path (proving loadConventions used
    // the global path, not the local one).
    const globalCfg: VaultConfig = {
      ...cfg,
      local: { path: globalRoot },
      vaultPath: globalRoot,
    }
    await bootstrapVault(globalCfg, { gitignore: false })

    const cfgWithGlobal: VaultConfig = {
      ...cfg,
      global: { path: globalRoot },
    }
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'global' },
    })
    const result = await writeNote(cfgWithGlobal, draft)
    expect(result.ok).toBe(true)
    // Conventions file in global vault was loaded (would have been
    // auto-regenerated if missing — bootstrapVault wrote it).
    expect(existsSync(join(globalRoot, '_conventions.md'))).toBe(true)
  })
})

describe('writeNote — escape-hatch on scope: global (PIFC-07)', () => {
  let repoRoot: string
  let cfg: VaultConfig
  let globalRoot: string

  beforeEach(async () => {
    repoRoot = makeRepo()
    cfg = makeConfig(repoRoot)
    globalRoot = mkdtempSync(join(tmpdir(), 'writenote-global-eh-'))
    await bootstrapVault(cfg, { gitignore: false })
    const globalCfg: VaultConfig = {
      ...cfg,
      local: { path: globalRoot },
      vaultPath: globalRoot,
    }
    await bootstrapVault(globalCfg, { gitignore: false })
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
    rmSync(globalRoot, { recursive: true, force: true })
  })

  test('scope: global + escapeHatch + dev says "no" → aborted-by-dev violation, no fs mutation', async () => {
    const { createResolverContext, createStubProvider } = await import(
      './escapeHatch/index.js'
    )
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const escapeHatch = createResolverContext(cfgWithGlobal, {
      provider: createStubProvider(['no']),
    })
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'global' },
    })
    const result = await writeNote(cfgWithGlobal, draft, { escapeHatch })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.violations[0]?.rule).toBe('aborted-by-dev')
    expect(result.violations[0]?.field).toBe('scope')
    // No file in global vault; existing _conventions.md is preserved.
    expect(
      existsSync(join(globalRoot, 'knowledge', 'concept-foo.md')),
    ).toBe(false)
  })

  test('scope: global + escapeHatch + dev says "yes" → write succeeds in global vault', async () => {
    const { createResolverContext, createStubProvider } = await import(
      './escapeHatch/index.js'
    )
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const escapeHatch = createResolverContext(cfgWithGlobal, {
      provider: createStubProvider(['yes']),
    })
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'global' },
    })
    const result = await writeNote(cfgWithGlobal, draft, { escapeHatch })
    expect(result.ok).toBe(true)
    expect(existsSync(join(globalRoot, 'knowledge', 'concept-foo.md'))).toBe(
      true,
    )
  })

  test('scope: global + confirmedGlobal: true → resolver NOT invoked (forbidden provider does not throw)', async () => {
    const { createResolverContext, createForbiddenProvider } = await import(
      './escapeHatch/index.js'
    )
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const escapeHatch = createResolverContext(cfgWithGlobal, {
      provider: createForbiddenProvider(),
    })
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'global' },
    })
    const result = await writeNote(cfgWithGlobal, draft, {
      escapeHatch,
      confirmedGlobal: true,
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(globalRoot, 'knowledge', 'concept-foo.md'))).toBe(
      true,
    )
  })

  test('scope: project + escapeHatch → resolver NOT invoked (forbidden provider does not throw)', async () => {
    const { createResolverContext, createForbiddenProvider } = await import(
      './escapeHatch/index.js'
    )
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const escapeHatch = createResolverContext(cfgWithGlobal, {
      provider: createForbiddenProvider(),
    })
    const draft = validConceptDraft({
      frontmatter: { ...validConceptDraft().frontmatter, scope: 'project' },
    })
    const result = await writeNote(cfgWithGlobal, draft, { escapeHatch })
    expect(result.ok).toBe(true)
    // File in local vault, not global.
    expect(
      existsSync(join(cfg.local.path, 'knowledge', 'concept-foo.md')),
    ).toBe(true)
  })
})

describe('writeNote — cross-vault WikiLink rules (PIFE-03/04/06)', () => {
  let repoRoot: string
  let cfg: VaultConfig
  let globalRoot: string

  beforeEach(async () => {
    repoRoot = makeRepo()
    cfg = makeConfig(repoRoot)
    globalRoot = mkdtempSync(join(tmpdir(), 'writenote-global-pife-'))
    await bootstrapVault(cfg, { gitignore: false })
    const globalCfg: VaultConfig = {
      ...cfg,
      local: { path: globalRoot },
      vaultPath: globalRoot,
    }
    await bootstrapVault(globalCfg, { gitignore: false })
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
    rmSync(globalRoot, { recursive: true, force: true })
  })

  test('PIFE-03: local note with [[global:slug]] in body → write succeeds (link skipped)', async () => {
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const draft = validConceptDraft({
      body: '# Foo\n\nSee [[global:typescript-strict-on]] for context.\n',
    })
    const result = await writeNote(cfgWithGlobal, draft)
    expect(result.ok).toBe(true)
    expect(
      existsSync(join(cfg.local.path, 'knowledge', 'concept-foo.md')),
    ).toBe(true)
  })

  test('PIFE-06: local note with [[global:slug]] in `related:` → write succeeds (link skipped)', async () => {
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const base = validConceptDraft()
    const draft = {
      ...base,
      frontmatter: {
        ...base.frontmatter,
        related: ['[[global:typescript-strict-on]]'],
      },
    }
    const result = await writeNote(cfgWithGlobal, draft)
    expect(result.ok).toBe(true)
  })

  test('PIFE-04: global note with [[project:my-module]] in body → REJECTED with type-scope-mismatch', async () => {
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const base = validConceptDraft()
    const draft = {
      ...base,
      frontmatter: { ...base.frontmatter, scope: 'global' as const },
      body: '# Foo\n\nSee [[project:my-module]] for the implementation.\n',
    }
    const result = await writeNote(cfgWithGlobal, draft, { confirmedGlobal: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.violations[0]?.rule).toBe('type-scope-mismatch')
    expect(result.violations[0]?.field).toBe('body')
    expect(result.violations[0]?.got).toBe('project:my-module')
    // No fs mutation in either vault.
    expect(existsSync(join(globalRoot, 'knowledge', 'concept-foo.md'))).toBe(false)
  })

  test('PIFE-04: global note with [[project:slug]] in `related:` → REJECTED with type-scope-mismatch on `related` field', async () => {
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const base = validConceptDraft()
    const draft = {
      ...base,
      frontmatter: {
        ...base.frontmatter,
        scope: 'global' as const,
        related: ['[[project:my-module]]'],
      },
    }
    const result = await writeNote(cfgWithGlobal, draft, { confirmedGlobal: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const v = result.violations.find((x) => x.rule === 'type-scope-mismatch')
    expect(v?.field).toBe('related')
  })

  test('PIFE-05: [[hallucinated-foo]] AND [[global:foo]] in same body → exactly ONE hallucinated-link (the local one); global skipped', async () => {
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const draft = validConceptDraft({
      body: '# Foo\n\nSee [[hallucinated-foo]] and [[global:foo]].\n',
    })
    const result = await writeNote(cfgWithGlobal, draft)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const hallucinated = result.violations.filter(
      (v) => v.rule === 'hallucinated-link',
    )
    expect(hallucinated).toHaveLength(1)
    expect(hallucinated[0]?.got).toBe('hallucinated-foo')
  })

  test('global note with [[global:other]] (sibling-link via _pendingLinks) → write succeeds', async () => {
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const base = validConceptDraft()
    const draft = {
      ...base,
      frontmatter: {
        ...base.frontmatter,
        scope: 'global' as const,
        // _pendingLinks lets the resolver accept the bare slug 'other-global'
        // as if it were already on disk (used for batch writes).
        _pendingLinks: ['other-global'],
      },
      body: '# Foo\n\nSee [[global:other-global]].\n',
    }
    const result = await writeNote(cfgWithGlobal, draft, { confirmedGlobal: true })
    expect(result.ok).toBe(true)
    expect(existsSync(join(globalRoot, 'knowledge', 'concept-foo.md'))).toBe(true)
  })

  test('local note with [[project:my-module]] (redundant explicit prefix) → treated as local, succeeds when slug exists', async () => {
    const cfgWithGlobal: VaultConfig = { ...cfg, global: { path: globalRoot } }
    const base = validConceptDraft()
    const draft = {
      ...base,
      frontmatter: { ...base.frontmatter, _pendingLinks: ['my-module'] },
      body: '# Foo\n\nSee [[project:my-module]].\n',
    }
    const result = await writeNote(cfgWithGlobal, draft)
    expect(result.ok).toBe(true)
  })
})

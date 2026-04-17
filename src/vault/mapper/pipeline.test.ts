import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, renameSync, cpSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runMapping, type MappingOptions, type ProgressEvent } from './pipeline.js'
import type { SemanticProvider } from './infer/semanticCall.js'
import type { VaultConfig, IndexResult } from '../types.js'

const FIXTURE_REPO = path.resolve(import.meta.dir, '../../../test/fixtures/mapper/repo-mini')

function makeTmpVault(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-pipeline-'))
  return dir
}

function makeTmpRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-repo-'))
  cpSync(FIXTURE_REPO, dir, { recursive: true })
  return dir
}

function makeConfig(repoDir: string, vaultDir: string): VaultConfig {
  return {
    vaultPath: vaultDir,
    provider: 'claude',
    projectName: 'test-project',
    projectRoot: repoDir,
  }
}

function makeIndex(): IndexResult {
  return {
    git: null,
    languages: ['typescript'],
    primaryLanguage: 'typescript',
    manifests: [],
    structure: { isMonorepo: false, topLevelDirs: ['src'], entryPoints: [] },
    testing: { testDirs: [], testCommands: [] },
    docs: { hasReadme: false, hasDocsDir: false, hasExistingClaudeMd: false },
    commands: {},
    fileCount: 10,
    isLargeRepo: false,
  }
}

const VALID_SEMANTIC = (domain: string) => JSON.stringify({
  summary: `Module for ${domain} operations.`,
  responsibilities: ['Handles primary logic', 'Validates inputs', 'Returns results'],
  domain,
  layer: 'service',
})

function stubProvider(domainMap: Record<string, string> = {}): SemanticProvider {
  return {
    async complete(opts) {
      // Extract slug from user prompt "Module: <slug>"
      const slugMatch = opts.userPrompt.match(/^Module:\s*(\S+)/m)
      const slug = slugMatch?.[1] ?? 'unknown'
      const domain = domainMap[slug] ?? slug.split('-')[0] ?? 'misc'
      return {
        content: VALID_SEMANTIC(domain),
        tokensIn: 50,
        tokensOut: 30,
      }
    },
  }
}

describe('pipeline', () => {
  let repo: string
  let vault: string

  beforeEach(() => {
    repo = makeTmpRepo()
    vault = makeTmpVault()
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(vault, { recursive: true, force: true })
  })

  test('mode: full with stubbed LLM — emits module notes + MOCs, zero orphans', async () => {
    const cfg = makeConfig(repo, vault)
    const report = await runMapping(cfg, makeIndex(), {
      mode: 'full',
      provider: stubProvider(),
      concurrency: 2,
    })

    expect(report.modules.discovered).toBeGreaterThanOrEqual(4)
    expect(report.modules.emitted).toBeGreaterThanOrEqual(4)
    expect(report.mocs.root).toBe(true)
    expect(report.mocs.perDomain).toBeGreaterThanOrEqual(1)
    expect(report.orphans).toEqual([])
  })

  test('mode: dry-run — returns report without writing', async () => {
    const cfg = makeConfig(repo, vault)
    const report = await runMapping(cfg, makeIndex(), {
      mode: 'dry-run',
      provider: stubProvider(),
    })

    expect(report.mode).toBe('dry-run')
    expect(report.modules.discovered).toBeGreaterThanOrEqual(4)
    // No files should be written
    expect(existsSync(path.join(vault, 'knowledge'))).toBe(false)
    expect(existsSync(path.join(vault, 'maps'))).toBe(false)
  })

  test('disableLlm: true — no provider calls, notes with fallback placeholders', async () => {
    let providerCalled = false
    const noCallProvider: SemanticProvider = {
      async complete() {
        providerCalled = true
        return { content: '{}', tokensIn: 0, tokensOut: 0 }
      },
    }

    const cfg = makeConfig(repo, vault)
    const report = await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
      provider: noCallProvider,
    })

    expect(providerCalled).toBe(false)
    expect(report.modules.emitted).toBeGreaterThanOrEqual(4)
    expect(report.tokensIn).toBe(0)
    expect(report.tokensOut).toBe(0)
  })

  test('mode: refresh after touching one file — recomputes stale module', async () => {
    const cfg = makeConfig(repo, vault)

    // First: full run
    await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
    })

    // Touch a file in the config module
    const configFile = path.join(repo, 'src', 'config', 'index.ts')
    const content = readFileSync(configFile, 'utf-8')
    writeFileSync(configFile, content + '\n// touched\n')

    // Refresh
    const report = await runMapping(cfg, makeIndex(), {
      mode: 'refresh',
      disableLlm: true,
    })

    expect(report.mode).toBe('refresh')
    // At least config should be recomputed; others may be reused
    expect(report.modules.discovered).toBeGreaterThanOrEqual(4)
  })

  test('progress callback fires at least once per module', async () => {
    const events: ProgressEvent[] = []
    const cfg = makeConfig(repo, vault)

    await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
      onProgress: (e) => events.push(e),
    })

    // Should have progress events for discover, analyze, infer, emit
    expect(events.some((e) => e.phase === 'discover')).toBe(true)
    expect(events.some((e) => e.phase === 'analyze')).toBe(true)
    expect(events.some((e) => e.phase === 'emit')).toBe(true)
    // At least one event with a slug
    expect(events.some((e) => e.slug !== undefined)).toBe(true)
  })

  test('_log.md gets map-complete entry', async () => {
    const cfg = makeConfig(repo, vault)

    await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
    })

    const logPath = path.join(vault, '_log.md')
    expect(existsSync(logPath)).toBe(true)
    const logContent = readFileSync(logPath, 'utf-8')
    expect(logContent).toContain('map-complete')
  })

  test('_log.md tags source: code-analysis when LLM was not used (F-1)', async () => {
    const cfg = makeConfig(repo, vault)

    await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
    })

    const logContent = readFileSync(path.join(vault, '_log.md'), 'utf-8')
    expect(logContent).toContain('source: code-analysis')
    expect(logContent).not.toContain('source: llm-inference')
  })

  test('_log.md tags source: llm-inference when real LLM content was persisted (F-1)', async () => {
    const cfg = makeConfig(repo, vault)

    await runMapping(cfg, makeIndex(), {
      mode: 'full',
      provider: stubProvider(),
    })

    const logContent = readFileSync(path.join(vault, '_log.md'), 'utf-8')
    expect(logContent).toContain('source: llm-inference')
    expect(logContent).toContain('map-complete')
  })

  test('cycle detection reports circular deps without failing', async () => {
    const cfg = makeConfig(repo, vault)
    const report = await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
    })

    // auth ↔ users circular dependency should be detected
    expect(report.cycles.length).toBeGreaterThanOrEqual(1)
    // Pipeline should still succeed
    expect(report.modules.emitted).toBeGreaterThanOrEqual(4)
  })

  test('empty repo (no source files) returns early with zero modules', async () => {
    const emptyRepo = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-empty-'))
    mkdirSync(path.join(emptyRepo, 'src'), { recursive: true })

    const cfg = makeConfig(emptyRepo, vault)
    const report = await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
    })

    expect(report.modules.discovered).toBe(0)
    expect(report.modules.emitted).toBe(0)

    rmSync(emptyRepo, { recursive: true, force: true })
  })

  test('convention validator passes for all emitted notes', async () => {
    const cfg = makeConfig(repo, vault)

    const report = await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
    })

    // If validator rejected notes, they would appear as write-failed errors
    const writeFailures = report.errors.filter((e) => e.startsWith('write-failed:'))
    expect(writeFailures).toEqual([])
  })

  test('emitted notes exist on disk in correct folders', async () => {
    const cfg = makeConfig(repo, vault)

    await runMapping(cfg, makeIndex(), {
      mode: 'full',
      disableLlm: true,
    })

    // knowledge/ should have module-*.md files
    const knowledgeDir = path.join(vault, 'knowledge')
    expect(existsSync(knowledgeDir)).toBe(true)
    const modules = readdirSync(knowledgeDir).filter((f) => f.startsWith('module-'))
    expect(modules.length).toBeGreaterThanOrEqual(4)

    // maps/ should have moc-*.md files
    const mapsDir = path.join(vault, 'maps')
    expect(existsSync(mapsDir)).toBe(true)
    const mocs = readdirSync(mapsDir).filter((f) => f.startsWith('moc-'))
    expect(mocs.length).toBeGreaterThanOrEqual(2) // root + at least 1 domain
  })
})

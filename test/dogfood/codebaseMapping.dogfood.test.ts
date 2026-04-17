/**
 * Dogfood integration test — runs the codebase mapper on the real bridgeai/ tree.
 *
 * Uses a stubbed provider (canned LLM responses) so no network is needed.
 * Excluded from default `bun test` — run via `bun run test:dogfood`.
 *
 * Asserts:
 * - ≥20 module notes emitted
 * - ≥5 per-domain MOCs
 * - Zero orphans
 * - All notes pass convention validator
 * - Generates reports/codebase-mapping-dogfood.md
 */

import { describe, test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runMapping } from '../../src/vault/mapper/index.js'
import type { SemanticProvider } from '../../src/vault/mapper/infer/semanticCall.js'
import type { VaultConfig, IndexResult } from '../../src/vault/types.js'

const BRIDGEAI_ROOT = path.resolve(import.meta.dir, '../..')

// Stubbed provider that returns plausible canned responses
function dogfoodProvider(): SemanticProvider {
  return {
    async complete(opts) {
      const slugMatch = opts.userPrompt.match(/^Module:\s*(\S+)/m)
      const slug = slugMatch?.[1] ?? 'unknown'

      // Derive a plausible domain from the slug
      const domainMap: Record<string, string> = {
        vault: 'vault', mapper: 'vault', scaffold: 'vault', onboard: 'vault',
        cli: 'cli', commands: 'cli', keybindings: 'cli',
        tools: 'tools', query: 'query',
        services: 'api', api: 'api',
        utils: 'utility', constants: 'utility',
        components: 'ui', screens: 'ui', ink: 'ui',
        hooks: 'hooks', plugins: 'plugins',
      }
      const firstSegment = slug.split('-')[0] ?? 'misc'
      const domain = domainMap[firstSegment] ?? firstSegment

      const response = {
        summary: `${slug} — handles ${domain}-related operations.`,
        responsibilities: [
          `Core ${domain} logic for ${slug}`,
          'Input validation and error handling',
          'Integration with dependent modules',
        ],
        domain,
        layer: 'service',
      }

      return {
        content: JSON.stringify(response),
        tokensIn: 100,
        tokensOut: 50,
      }
    },
  }
}

describe('dogfood: codebase mapping on bridgeai/', () => {
  let vault: string

  afterAll(() => {
    if (vault) rmSync(vault, { recursive: true, force: true })
  })

  test('maps bridgeai/ with ≥20 modules, ≥5 MOCs, zero orphans', async () => {
    vault = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-dogfood-'))

    const cfg: VaultConfig = {
      vaultPath: vault,
      provider: 'claude',
      projectName: 'bridgeai',
      projectRoot: BRIDGEAI_ROOT,
    }

    const index: IndexResult = {
      git: null,
      languages: ['typescript'],
      primaryLanguage: 'typescript',
      manifests: [{ path: 'package.json', type: 'npm', language: 'typescript' }],
      structure: { isMonorepo: false, topLevelDirs: ['src'], entryPoints: ['src/entrypoints'] },
      testing: { testDirs: ['test'], testCommands: ['bun test'] },
      docs: { hasReadme: true, readmePath: 'README.md', hasDocsDir: true, hasExistingClaudeMd: false },
      commands: { test: 'bun test', build: 'bun run build' },
      fileCount: 500,
      isLargeRepo: false,
    }

    let lastPhase = ''
    const report = await runMapping(cfg, index, {
      mode: 'full',
      provider: dogfoodProvider(),
      concurrency: 4,
      onProgress: (event) => {
        if (event.phase !== lastPhase) {
          process.stdout.write(`\n[dogfood] ${event.phase}: 0/${event.total}\n`)
          lastPhase = event.phase
        }
        if (event.total > 0 && event.current % 25 === 0) {
          process.stdout.write(`[dogfood] ${event.phase}: ${event.current}/${event.total}\n`)
        }
      },
    })

    // Core assertions
    expect(report.modules.emitted).toBeGreaterThanOrEqual(20)
    expect(report.mocs.perDomain).toBeGreaterThanOrEqual(5)
    expect(report.orphans).toEqual([])

    // Verify no write failures (convention validator passed for all)
    const writeFailures = report.errors.filter((e) => e.startsWith('write-failed:'))
    expect(writeFailures).toEqual([])

    // Verify files exist on disk
    const knowledgeDir = path.join(vault, 'knowledge')
    const mapsDir = path.join(vault, 'maps')
    const moduleFiles = readdirSync(knowledgeDir).filter((f) => f.startsWith('module-'))
    const mocFiles = readdirSync(mapsDir).filter((f) => f.startsWith('moc-'))

    expect(moduleFiles.length).toBeGreaterThanOrEqual(20)
    expect(mocFiles.length).toBeGreaterThanOrEqual(6) // root + ≥5 domain

    // Generate dogfood report
    const reportLines = [
      '# Codebase Mapping Dogfood Report',
      '',
      `**Date:** ${new Date().toISOString().slice(0, 10)}`,
      `**Mode:** ${report.mode}`,
      `**Modules discovered:** ${report.modules.discovered}`,
      `**Modules emitted:** ${report.modules.emitted}`,
      `**Domain MOCs:** ${report.mocs.perDomain}`,
      `**Root MOC:** ${report.mocs.root}`,
      `**Orphans:** ${report.orphans.length}`,
      `**Cycles:** ${report.cycles.length}`,
      `**Errors:** ${report.errors.length}`,
      `**Tokens:** ${report.tokensIn} in / ${report.tokensOut} out`,
      '',
      '## Emitted Module Notes',
      '',
      ...moduleFiles.sort().map((f) => `- ${f}`),
      '',
      '## Domain MOCs',
      '',
      ...mocFiles.sort().map((f) => `- ${f}`),
      '',
      '## Errors',
      '',
      ...(report.errors.length > 0 ? report.errors.map((e) => `- ${e}`) : ['None.']),
      '',
    ]

    const reportsDir = path.join(BRIDGEAI_ROOT, 'reports')
    mkdirSync(reportsDir, { recursive: true })
    writeFileSync(
      path.join(reportsDir, 'codebase-mapping-dogfood.md'),
      reportLines.join('\n'),
      'utf-8',
    )
  }, 900_000) // 15 minute timeout — ts-morph parses 2k+ TS files on real bridgeai tree
})

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { VaultConfig, IndexResult } from '../types.js'
import type { ModuleCandidate, ModuleDescriptor } from './types.js'

// Discover
import { resolveSourceRoot } from './discover/sourceRoot.js'
import { enumerateModules } from './discover/enumerate.js'

// Analyze
import { createTsParser } from './analyze/tsParser.js'
import { extractExports } from './analyze/extractExports.js'
import { extractImports, type ImportRef } from './analyze/extractImports.js'
import { buildEdges } from './analyze/edges.js'

// Refresh
import { classifyModules, computeEdgeHash, type ExistingModule, type CurrentAnalysis } from './refresh/staleness.js'
import { archiveMissing, type ExistingModuleRef } from './refresh/archive.js'

// Infer
import { inferBatch } from './infer/inferBatch.js'
import { coerceSemanticResponse, type SemanticResult } from './infer/coerce.js'
import type { SemanticProvider } from './infer/semanticCall.js'
import type { PromptInput } from './infer/promptBuilder.js'

// Emit
import { toModuleNoteDraft } from './emit/moduleNote.js'
import { generateMocs } from './emit/mocs.js'
import { runOrphanGate } from './emit/orphanGate.js'

// Vault infrastructure
import { writeNote, type WriteResult } from '../writeNote.js'

// ---------- Public types ----------

export type MappingMode = 'full' | 'refresh' | 'dry-run' | 'onboarding'

export interface MappingOptions {
  mode: MappingMode
  disableLlm?: boolean
  concurrency?: number
  largeRepo?: boolean
  provider?: SemanticProvider
  onProgress?: (event: ProgressEvent) => void
}

export interface ProgressEvent {
  phase: string
  current: number
  total: number
  slug?: string
}

export interface MappingReport {
  mode: MappingMode
  modules: {
    discovered: number
    emitted: number
    reused: number
    skipped: number
    archived: number
  }
  mocs: {
    root: boolean
    perDomain: number
  }
  orphans: string[]
  cycles: string[][]
  errors: string[]
  tokensIn: number
  tokensOut: number
}

// ---------- Pipeline ----------

export async function runMapping(
  cfg: VaultConfig,
  indexResult: IndexResult,
  opts: MappingOptions,
): Promise<MappingReport> {
  const report: MappingReport = {
    mode: opts.mode,
    modules: { discovered: 0, emitted: 0, reused: 0, skipped: 0, archived: 0 },
    mocs: { root: false, perDomain: 0 },
    orphans: [],
    cycles: [],
    errors: [],
    tokensIn: 0,
    tokensOut: 0,
  }

  const progress = opts.onProgress ?? (() => {})

  try {
    // 1. Discover
    progress({ phase: 'discover', current: 0, total: 1 })
    const sourceRoots = resolveSourceRoot(cfg.projectRoot, indexResult)
    const candidates: ModuleCandidate[] = []
    for (const root of sourceRoots) {
      candidates.push(...enumerateModules(root, cfg.projectRoot))
    }
    report.modules.discovered = candidates.length

    if (candidates.length === 0) {
      appendLog(cfg.vaultPath, 'map-complete', `0 modules discovered — nothing to map`)
      return report
    }

    // 2. Analyze (always runs — cheap static analysis)
    progress({ phase: 'analyze', current: 0, total: candidates.length })
    const parser = createTsParser(cfg.projectRoot)

    const exportsByModule = new Map<string, string[]>()
    const importsByModule = new Map<string, ImportRef[]>()
    const analyzeErrors: string[] = []

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      progress({ phase: 'analyze', current: i + 1, total: candidates.length, slug: c.slug })

      const expResult = extractExports(parser, c.files)
      exportsByModule.set(c.slug, expResult.exports)
      for (const e of expResult.errors) {
        analyzeErrors.push(`export-parse-error: ${e.file}: ${e.message}`)
      }

      const impResult = extractImports(parser, c.files)
      importsByModule.set(c.slug, impResult.imports)
      for (const e of impResult.errors) {
        analyzeErrors.push(`import-parse-error: ${e.file}: ${e.message}`)
      }
    }

    report.errors.push(...analyzeErrors)

    const edgeResult = buildEdges(candidates, importsByModule)
    report.cycles = edgeResult.cycles

    // 3. Refresh: classify existing notes
    const existingModules = readExistingModules(cfg.vaultPath)
    const currentAnalysis: CurrentAnalysis[] = candidates.map((c) => ({
      slug: c.slug,
      sourcePath: c.sourcePath,
      files: c.files,
      dependsOn: edgeResult.dependsOn.get(c.slug) ?? [],
      exports: exportsByModule.get(c.slug) ?? [],
    }))

    const classification = classifyModules(
      existingModules.map((e) => ({
        slug: e.slug,
        sourcePath: e.sourcePath,
        lastVerified: e.lastVerified,
        edgeHash: e.edgeHash,
      })),
      currentAnalysis,
    )

    // Archive removed modules
    const archiveOps = archiveMissing(
      existingModules.map((e) => ({ slug: e.slug, sourcePath: e.sourcePath, currentFolder: e.folder })),
      candidates,
    )

    // Determine which modules need work
    let toProcess: string[]
    if (opts.mode === 'full' || opts.mode === 'onboarding') {
      toProcess = [...classification.recompute, ...classification.missing]
      // In full mode, also reprocess reuse to update notes
      if (opts.mode === 'full') {
        toProcess = candidates.map((c) => c.slug)
      }
    } else {
      // refresh mode: only recompute + missing
      toProcess = [...classification.recompute, ...classification.missing]
    }
    report.modules.reused = candidates.length - toProcess.length
    report.modules.skipped = classification.reuse.length - (opts.mode === 'full' ? classification.reuse.length : 0)

    // Dry-run: return report without writing
    if (opts.mode === 'dry-run') {
      report.modules.archived = archiveOps.length
      return report
    }

    // 4. Infer (semantic LLM pass) — only for modules that need processing
    progress({ phase: 'infer', current: 0, total: toProcess.length })
    const candidateBySlug = new Map(candidates.map((c) => [c.slug, c]))

    const semanticResults = new Map<string, SemanticResult>()

    if (!opts.disableLlm && opts.provider && toProcess.length > 0) {
      const inputs: PromptInput[] = toProcess.map((slug) => {
        const c = candidateBySlug.get(slug)!
        return {
          slug: c.slug,
          sourcePath: c.sourcePath,
          files: c.files,
          repoRoot: cfg.projectRoot,
          exports: exportsByModule.get(c.slug) ?? [],
          imports: (importsByModule.get(c.slug) ?? []).map((i) => ({
            specifier: i.specifier,
            resolvedPath: i.resolvedPath,
            isTypeOnly: i.isTypeOnly,
          })),
        }
      })

      const results = await inferBatch(inputs, opts.provider, {
        concurrency: opts.concurrency ?? 4,
        disableLlm: false,
      })

      for (let i = 0; i < toProcess.length; i++) {
        semanticResults.set(toProcess[i], results[i])
        report.tokensIn += results[i].tokensIn
        report.tokensOut += results[i].tokensOut
        progress({ phase: 'infer', current: i + 1, total: toProcess.length, slug: toProcess[i] })
      }
    } else {
      // No LLM — use fallback for all
      for (const slug of toProcess) {
        semanticResults.set(slug, coerceSemanticResponse(null, 0, 0))
      }
    }

    // 5. Build descriptors
    const descriptors: ModuleDescriptor[] = toProcess.map((slug) => {
      const c = candidateBySlug.get(slug)!
      const semantic = semanticResults.get(slug) ?? coerceSemanticResponse(null, 0, 0)
      return {
        slug: c.slug,
        sourcePath: c.sourcePath,
        files: c.files,
        language: c.language,
        exports: exportsByModule.get(c.slug) ?? [],
        dependsOn: edgeResult.dependsOn.get(c.slug) ?? [],
        dependedBy: edgeResult.dependedBy.get(c.slug) ?? [],
        externals: edgeResult.externalByModule.get(c.slug) ?? [],
        summary: semantic.summary,
        responsibilities: semantic.responsibilities,
        domain: semantic.domain,
        layer: semantic.layer,
        fallback: semantic.fallback,
        staticOnly: opts.disableLlm === true || !opts.provider,
      }
    })

    // 6. Emit — write module notes
    progress({ phase: 'emit', current: 0, total: descriptors.length })

    // Generate MOCs first to get backEdges
    const mocResult = generateMocs(descriptors)

    for (let i = 0; i < descriptors.length; i++) {
      const d = descriptors[i]
      progress({ phase: 'emit', current: i + 1, total: descriptors.length, slug: d.slug })

      const draft = toModuleNoteDraft(d)

      // Patch related with MOC back-edges
      const mocEdges = mocResult.backEdges.get(d.slug) ?? []
      if (mocEdges.length > 0) {
        const related = (draft.frontmatter.related as string[]) ?? []
        draft.frontmatter.related = [...related, ...mocEdges.map((m) => `[[${m}]]`)]
        // Add MOC filenames to pending links
        const pending = (draft.frontmatter._pendingLinks as string[]) ?? []
        draft.frontmatter._pendingLinks = [...pending, ...mocEdges]
      }

      try {
        const result = await writeNote(cfg, draft)
        if (result.ok) {
          report.modules.emitted++
        } else {
          report.errors.push(`write-failed: module-${d.slug}: ${result.violations.map((v) => `${v.field}:${v.rule}`).join(', ')}`)
        }
      } catch (err) {
        report.errors.push(`write-error: module-${d.slug}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Write MOCs
    try {
      const rootResult = await writeNote(cfg, mocResult.root)
      if (rootResult.ok) report.mocs.root = true
      else report.errors.push(`write-failed: moc-codebase: ${rootResult.violations.map((v) => `${v.field}:${v.rule}`).join(', ')}`)
    } catch (err) {
      report.errors.push(`write-error: moc-codebase: ${err instanceof Error ? err.message : String(err)}`)
    }

    for (const moc of mocResult.perDomain) {
      try {
        const result = await writeNote(cfg, moc)
        if (result.ok) report.mocs.perDomain++
        else report.errors.push(`write-failed: ${moc.filename}: ${result.violations.map((v) => `${v.field}:${v.rule}`).join(', ')}`)
      } catch (err) {
        report.errors.push(`write-error: ${moc.filename}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Execute archive ops
    for (const op of archiveOps) {
      try {
        const fromPath = join(cfg.vaultPath, op.from)
        const toPath = join(cfg.vaultPath, op.to)
        if (existsSync(fromPath)) {
          mkdirSync(join(cfg.vaultPath, 'archive'), { recursive: true })
          renameSync(fromPath, toPath)
          report.modules.archived++
        }
      } catch (err) {
        report.errors.push(`archive-error: ${op.slug}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 7. Orphan gate
    const orphanResult = runOrphanGate(cfg.vaultPath)
    report.orphans = orphanResult.orphans

    // 8. Append to _log.md
    const logEntry = buildLogEntry(report)
    appendLog(cfg.vaultPath, report.errors.some((e) => e.startsWith('write-error:')) ? 'map-aborted' : 'map-complete', logEntry)

  } catch (err) {
    report.errors.push(`pipeline-error: ${err instanceof Error ? err.message : String(err)}`)
    appendLog(cfg.vaultPath, 'map-aborted', `pipeline-error: ${err instanceof Error ? err.message : String(err)}`)
  }

  return report
}

// ---------- Helpers ----------

interface ExistingModuleParsed {
  slug: string
  sourcePath: string
  lastVerified: string
  edgeHash: string
  folder: string
}

/**
 * Read existing module notes from knowledge/ to feed into staleness check.
 */
function readExistingModules(vaultPath: string): ExistingModuleParsed[] {
  const knowledgeDir = join(vaultPath, 'knowledge')
  if (!existsSync(knowledgeDir)) return []

  const results: ExistingModuleParsed[] = []
  try {
    const files = require('node:fs').readdirSync(knowledgeDir) as string[]
    for (const file of files) {
      if (!file.startsWith('module-') || !file.endsWith('.md')) continue
      try {
        const content = readFileSync(join(knowledgeDir, file), 'utf-8')
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (!fmMatch) continue

        const fm = fmMatch[1]
        const sourcePath = extractFmValue(fm, 'source_path') ?? ''
        const lastVerified = extractFmValue(fm, 'last_verified') ?? '1970-01-01'
        const dependsOn = extractFmArray(fm, 'depends_on')
        const exports = extractFmArray(fm, 'exports')

        const slug = file.replace(/^module-/, '').replace(/\.md$/, '')
        results.push({
          slug,
          sourcePath,
          lastVerified,
          edgeHash: computeEdgeHash(dependsOn, exports),
          folder: 'knowledge',
        })
      } catch { /* skip unreadable */ }
    }
  } catch { /* knowledge/ doesn't exist yet */ }

  return results
}

function extractFmValue(fm: string, key: string): string | null {
  const match = fm.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm'))
  return match ? match[1].trim() : null
}

function extractFmArray(fm: string, key: string): string[] {
  // Match inline array: key: [a, b, c]
  const inlineMatch = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'))
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  return []
}

function appendLog(vaultPath: string, kind: string, detail: string): void {
  const ts = new Date().toISOString()
  const line = `- ${ts}  ${kind}  ${detail}  source: code-analysis\n`
  const logPath = join(vaultPath, '_log.md')
  mkdirSync(vaultPath, { recursive: true })
  if (!existsSync(logPath)) {
    writeFileSync(logPath, `# Vault log\n\n${line}`, 'utf-8')
    return
  }
  const content = readFileSync(logPath, 'utf-8')
  const needsNl = content.length > 0 && !content.endsWith('\n')
  writeFileSync(logPath, content + (needsNl ? '\n' : '') + line, 'utf-8')
}

function buildLogEntry(report: MappingReport): string {
  const parts = [
    `mode=${report.mode}`,
    `discovered=${report.modules.discovered}`,
    `emitted=${report.modules.emitted}`,
    `reused=${report.modules.reused}`,
    `archived=${report.modules.archived}`,
    `orphans=${report.orphans.length}`,
    `cycles=${report.cycles.length}`,
    `errors=${report.errors.length}`,
    `tokens_in=${report.tokensIn}`,
    `tokens_out=${report.tokensOut}`,
  ]
  return parts.join(' ')
}

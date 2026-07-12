/**
 * Knowledge Graph — compatibility layer over memdir.
 *
 * Previously maintained its own SQLite/JSON/Orama storage. Now delegates
 * to memdir for storage and vector search. The Entity/Relation/Summary
 * types are kept for backward compatibility; the actual data lives as
 * structured .md files in the auto-memory directory.
 */

import { readFileSync, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getAutoMemPath } from '../memdir/paths.js'
import { initMemdirIndex, searchMemdirIndex, clearIndex, getIndexPath, getIndexMetaPath } from '../memdir/vectorIndex.js'
import { parseFrontmatter } from './frontmatterParser.js'
import { getProjectsDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'
import { getFsImplementation } from './fsOperations.js'

export interface Entity {
  id: string
  type: string
  name: string
  attributes: Record<string, string>
}

export interface Relation {
  sourceId: string
  targetId: string
  type: string
}

export interface SemanticSummary {
  id: string
  content: string
  keywords: string[]
  timestamp: number
}

export interface KnowledgeGraph {
  entities: Record<string, Entity>
  relations: Relation[]
  summaries: SemanticSummary[]
  rules: string[]
  lastUpdateTime: number
}

const FACTS_SUBDIR = '.facts'

function getFactsDir(): string {
  const memDir = getAutoMemPath()
  return memDir ? join(memDir, FACTS_SUBDIR) : ''
}

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s,;:()\"'`?]+/)
    .filter(word => word.length >= 2)
    .map(word => {
      if (/^\d+\.\d+/.test(word)) return word
      return word.replace(/\.$/g, '')
    })
    .filter(word => word.length >= 2)

  const extraWords: string[] = []
  for (const w of words) {
    if (w.endsWith('s') && w.length > 3) {
      extraWords.push(w.slice(0, -1))
    }
  }

  return Array.from(new Set([...words, ...extraWords]))
}

function calculateBM25Score(
  queryWords: string[],
  summary: SemanticSummary,
  allSummaries: SemanticSummary[],
): number {
  let totalScore = 0
  const totalDocs = allSummaries.length || 1

  for (const word of queryWords) {
    const tf =
      summary.keywords.filter(k => k === word).length ||
      (summary.content.toLowerCase().includes(word) ? 1 : 0)

    const docsWithWord =
      allSummaries.filter(
        s =>
          s.keywords.includes(word) || s.content.toLowerCase().includes(word),
      ).length || 1

    const idf = Math.log(
      (totalDocs - docsWithWord + 0.5) / (docsWithWord + 0.5) + 1,
    )
    totalScore += (idf * (tf * 2.2)) / (tf + 1.2)
  }

  return totalScore
}

let legacyMigrationDone = false

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function getLegacyGraphPath(): string {
  const cwd = getFsImplementation().cwd()
  return join(getProjectsDir(), sanitizePath(cwd), 'knowledge_graph.json')
}

function migrateLegacyKnowledgeGraph(): void {
  if (legacyMigrationDone) return

  const legacyPath = getLegacyGraphPath()
  if (!existsSync(legacyPath)) {
    legacyMigrationDone = true
    return
  }

  let data: any
  try {
    data = JSON.parse(readFileSync(legacyPath, 'utf-8'))
  } catch (e) {
    console.error('[knowledgeGraph] Legacy migration: cannot read legacy file, skipping:', e)
    legacyMigrationDone = true
    return
  }

  // Create a backup before any writes so data can be recovered.
  const backupPath = `${legacyPath}.backup-${Date.now()}`
  try {
    writeFileSync(backupPath, readFileSync(legacyPath))
  } catch {
    console.error('[knowledgeGraph] Legacy migration: cannot create backup, aborting')
    return
  }

  const memDir = getAutoMemPath()
  if (!memDir) return

  const factsDir = join(memDir, FACTS_SUBDIR)
  try {
    if (!existsSync(factsDir)) {
      mkdirSync(factsDir, { recursive: true })
    }

    let count = 0

    // Migrate entities
    const legacyEntities: Entity[] = Object.values(data.entities ?? {})
    for (const entity of legacyEntities) {
      const slug = slugify(entity.name)
      const content = `---
type: reference
title: "${entity.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
description: "Migrated from legacy knowledge graph: ${entity.type}"
factType: ${entity.type}
source: legacy_migration
---
Auto-migrated from legacy store: **${entity.name}**
`
      writeFileSync(join(factsDir, `fact-${entity.type}-${slug}.md`), content, 'utf-8')
      count++
    }

    // Migrate summaries
    for (const summary of data.summaries ?? []) {
      const slug = summary.id || `summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const content = `---
type: reference
title: "Knowledge Summary"
description: "${(summary.content ?? '').slice(0, 200).replace(/"/g, '\\"')}"
factType: summary
keywords: "${(summary.keywords ?? []).join(', ')}"
source: legacy_migration
---
${summary.content ?? ''}
`
      writeFileSync(join(factsDir, `fact-summary-${slug}.md`), content, 'utf-8')
      count++
    }

    // Migrate rules — store as fact-type "rule" `.facts` files so they remain
    // searchable via the vector index.
    for (const rule of data.rules ?? []) {
      if (typeof rule !== 'string') continue
      const slug = slugify(rule)
      const content = `---
type: reference
title: "${rule.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
description: "Migrated legacy rule"
factType: rule
source: legacy_migration
---
${rule}
`
      writeFileSync(join(factsDir, `fact-rule-${slug}.md`), content, 'utf-8')
      count++
    }

    // Relations are not stored in the new memdir model. Log them for audit.
    const relCount = (data.relations ?? []).length
    if (relCount > 0) {
      console.error(`[knowledgeGraph] Legacy migration: ${relCount} relations are not migrated (memdir stores entity-level facts only).`)
    }

    // Guard is set only after all writes succeed.
    legacyMigrationDone = true
    console.error(`[knowledgeGraph] Migrated ${count} items from legacy store. Backup saved at ${backupPath}`)
  } catch (e) {
    console.error('[knowledgeGraph] Legacy migration failed during write phase. Backup preserved at:', backupPath, e)
    // Do NOT set legacyMigrationDone so migration is retried on next access.
  }
}

export function getGlobalGraph(): KnowledgeGraph {
  migrateLegacyKnowledgeGraph()
  const factsDir = getFactsDir()
  const entities: Record<string, Entity> = {}

  if (factsDir && existsSync(factsDir)) {
    try {
      const files = readdirSync(factsDir)
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        const filePath = join(factsDir, file)
        try {
          const raw = readFileSync(filePath, 'utf-8')
          const parsed = parseFrontmatter(raw)
          const fm = parsed?.frontmatter
          if (fm?.title && typeof fm.title === 'string') {
            const id = `fact_${file}`
            entities[id] = {
              id,
              type: typeof fm.factType === 'string' ? fm.factType : 'fact',
              name: fm.title,
              attributes: fm.description && typeof fm.description === 'string'
                ? { description: fm.description }
                : {},
            }
          }
        } catch {
          // skip
        }
      }
    } catch {
      // facts dir not readable
    }
  }

  return {
    entities,
    relations: [],
    summaries: [],
    rules: [],
    lastUpdateTime: Date.now(),
  }
}

export function getGlobalGraphSummary(): string {
  const graph = getGlobalGraph()
  const entities = Object.values(graph.entities)
  if (entities.length === 0) return ''

  let summary = '\nKnowledge Graph Snapshot (Most Recent):\n'
  const recentEntities = entities.slice(-10)

  for (const entity of recentEntities) {
    summary += `- [${entity.type}] ${entity.name}`
    const attrs = Object.entries(entity.attributes)
    if (attrs.length > 0) {
      summary += ` (${attrs.map(([k, v]) => `${k}: ${v}`).join(', ')})`
    }
    summary += '\n'
  }

  return summary
}

export async function getOrchestratedMemory(query: string): Promise<string> {
  const memDir = getAutoMemPath()
  if (!memDir || !query) return ''

  try {
    await initMemdirIndex(memDir)
    const results = await searchMemdirIndex(query, memDir, 10)

    if (results.length > 0) {
      let output = '\n--- [PERSISTENT PROJECT MEMORY (VECTOR RAG)] ---\n'
      for (const r of results.slice(0, 8)) {
        output += `- ${r.title}`
        if (r.description) output += `: ${r.description}`
        output += '\n'
      }
      return output + '------------------------------------------------\n'
    }
  } catch {
    // vector search unavailable
  }

  return ''
}

export async function searchGlobalGraph(query: string): Promise<string> {
  const queryWords = extractKeywords(query)
  if (queryWords.length === 0) return ''
  return getOrchestratedMemory(query)
}

export function resetGlobalGraph(): void {
  const factsDir = getFactsDir()
  if (factsDir && existsSync(factsDir)) {
    try {
      const files = readdirSync(factsDir)
      for (const file of files) {
        try {
          rmSync(join(factsDir, file), { force: true })
        } catch {
          // skip
        }
      }
    } catch {
      // not accessible
    }
  }
  // Remove the persisted .vector-index and .vector-index-meta.json files
  const memDir = getAutoMemPath()
  if (memDir) {
    const indexPath = getIndexPath(memDir)
    if (existsSync(indexPath)) {
      try { rmSync(indexPath, { force: true }) } catch { /* ignore */ }
    }
    const metaPath = getIndexMetaPath(memDir)
    if (existsSync(metaPath)) {
      try { rmSync(metaPath, { force: true }) } catch { /* ignore */ }
    }
  }
  clearIndex()
}

export function clearMemoryOnly(): void {
  // no-op: memdir is file-based, no in-memory cache to clear
}

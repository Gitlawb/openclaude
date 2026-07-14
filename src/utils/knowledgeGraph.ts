/**
 * Knowledge Graph — compatibility layer over memdir.
 *
 * Previously maintained its own SQLite/JSON/Orama storage. Now delegates
 * to memdir for storage and vector search. The Entity/Relation/Summary
 * types are kept for backward compatibility; the actual data lives as
 * structured .md files in the auto-memory directory.
 */

import { readFileSync, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { join, basename } from 'path'
import { getAutoMemPath } from '../memdir/paths.js'
import { searchMemdirIndex, clearIndex, getIndexPath, getIndexMetaPath } from '../memdir/vectorIndex.js'
import { parseFrontmatter } from './frontmatterParser.js'
import { getProjectsDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'
import { getFsImplementation } from './fsOperations.js'
import { isAutoMemoryEnabled } from '../memdir/paths.js'
import { isMemoryWriteApprovalRequired } from './governancePolicy.js'
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)

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

// Track migration completion per project. The legacy JSON/SQLite paths are
// derived from the current project (cwd), so the guard must be scoped per
// project — a single global flag would let a project without a legacy graph
// suppress migration for all later projects in the same process.
const legacyMigrationDoneProjects = new Set<string>()
// Track projects where auto-memory was disabled — these must NOT be added to
// legacyMigrationDoneProjects so that a later re-enable in the same process
// does not find the guard set and permanently short-circuit migration.
const legacyMigrationSkippedProjects = new Set<string>()

function currentProjectKey(): string {
  return sanitizePath(getFsImplementation().cwd())
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function yamlQuote(val: string): string {
  const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
  return `"${escaped}"`
}

function getLegacyGraphPath(): string {
  return join(getProjectsDir(), currentProjectKey(), 'knowledge_graph.json')
}

function getLegacySqlitePath(): string {
  return join(getProjectsDir(), currentProjectKey(), 'knowledge.db')
}

function migrateLegacyKnowledgeGraph(): void {
  const projectKey = currentProjectKey()
  if (legacyMigrationDoneProjects.has(projectKey)) return

  // If auto-memory was disabled in a prior call but is now re-enabled,
  // clear the skipped marker so migration can proceed.
  if (legacyMigrationSkippedProjects.has(projectKey)) {
    if (!isAutoMemoryEnabled()) return
    legacyMigrationSkippedProjects.delete(projectKey)
  }

  // Honor the opt-out. A user who disabled auto-memory must not receive
  // persistent memory writes from a status/list/read path. Migration writes
  // to the memdir, so it is gated on the same auto-memory toggle. Track
  // "skipped" separately from "completed" so a re-enable is not short-circuited.
  if (!isAutoMemoryEnabled()) {
    legacyMigrationSkippedProjects.add(projectKey)
    return
  }

  // Respect the same memory-write approval policy as extractMemories: do not
  // silently write migrated facts into .facts/ without user approval.
  if (isMemoryWriteApprovalRequired()) {
    legacyMigrationSkippedProjects.add(projectKey)
    return
  }

  const legacyPath = getLegacyGraphPath()
  const sqlitePath = getLegacySqlitePath()

  // Prefer SQLite when available and newer than JSON (or JSON absent).
  // However, do not prefer an empty SQLite store over a populated JSON graph:
  // the deleted SQLite provider created DBs eagerly, so users with an empty
  // DB + older JSON lose data if SQLite wins on mtime alone.
  let data: any
  let sourcePath = ''

  if (existsSync(sqlitePath)) {
    const sqliteMtime = statSync(sqlitePath).mtimeMs
    const jsonExists = existsSync(legacyPath)
    const jsonMtime = jsonExists ? statSync(legacyPath).mtimeMs : 0
    if (!jsonExists || sqliteMtime >= jsonMtime) {
      sourcePath = sqlitePath
      data = readLegacySqliteStore()
      // Fall back to JSON when SQLite has no entities — the store was empty
      // but the JSON graph may still have real content.
      if (data && Object.keys(data.entities).length === 0 && jsonExists) {
        data = null
      }
    }
  }

  if (!data && existsSync(legacyPath)) {
    sourcePath = legacyPath
    try {
      data = JSON.parse(readFileSync(legacyPath, 'utf-8'))
    } catch (e) {
      console.error('[knowledgeGraph] Legacy migration: cannot read legacy file, skipping:', e)
      legacyMigrationDoneProjects.add(projectKey)
      return
    }
  }

  if (!data) {
    legacyMigrationDoneProjects.add(projectKey)
    return
  }

  doMigration(data, sourcePath, projectKey)
}

function readLegacySqliteStore(): any | null {
  const dbPath = getLegacySqlitePath()
  if (!existsSync(dbPath)) return null

  let Database: any
  try {
    Database = _require('bun:sqlite').Database
  } catch {
    console.error('[knowledgeGraph] bun:sqlite not available; cannot migrate SQLite store.')
    return null
  }

  try {
    const db = new Database(dbPath)
    const data: any = { entities: {}, relations: [], summaries: [], rules: [] }

    const entityRows = db.query('SELECT id, type, name, attributes FROM entities').all() as any[]
    for (const row of entityRows) {
      data.entities[row.id] = {
        id: row.id,
        type: row.type ?? '',
        name: row.name ?? '',
        attributes: row.attributes ? JSON.parse(row.attributes) : {},
      }
    }

    data.relations = (db.query('SELECT source_id, target_id, type FROM relations').all() as any[]).map(
      (r: any) => ({ sourceId: r.source_id, targetId: r.target_id, type: r.type }),
    )

    const summaryRows = db.query('SELECT id, content, keywords, timestamp FROM summaries').all() as any[]
    data.summaries = summaryRows.map((r: any) => ({
      id: r.id,
      content: r.content ?? '',
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      timestamp: r.timestamp ?? 0,
    }))

    data.rules = (db.query('SELECT content FROM rules').all() as any[]).map((r: any) => r.content)

    db.close()
    return data
  } catch (e) {
    console.error('[knowledgeGraph] Failed to read SQLite store:', e)
    return null
  }
}

function doMigration(data: any, sourcePath: string, projectKey: string): void {
  // Create a backup before any writes so data can be recovered.
  const backupPath = `${sourcePath}.backup-${Date.now()}`
  if (existsSync(sourcePath)) {
    try {
      writeFileSync(backupPath, readFileSync(sourcePath))
    } catch {
      console.error('[knowledgeGraph] Legacy migration: cannot create backup, aborting')
      return
    }
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
      const nameSlug = slugify(entity.name)
      // Slugify entity.type too — a legacy row with type "x/../../planted"
      // would write outside .facts/ and plant/clobber files under memory/.
      const typeSlug = slugify(entity.type || 'unknown')
      const attrsYaml = Object.entries(entity.attributes ?? {})
        .map(([k, v]) => `  ${k}: ${yamlQuote(String(v))}`)
        .join('\n')
      const content = `---
type: reference
title: ${yamlQuote(entity.name)}
description: "Migrated from legacy knowledge graph: ${entity.type}"
factType: ${yamlQuote(entity.type)}
source: legacy_migration
${attrsYaml ? `attributes:\n${attrsYaml}` : ''}
---
Auto-migrated from legacy store: **${entity.name}**
`
      writeFileSync(join(factsDir, `fact-${typeSlug}-${nameSlug}.md`), content, 'utf-8')
      count++
    }

    // Migrate summaries
    for (const summary of data.summaries ?? []) {
      // Slugify summary.id as well — legacy IDs are raw strings that could
      // contain path-separator characters.
      const rawId = summary.id || `summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const idSlug = slugify(rawId)
      const content = `---
type: reference
title: "Knowledge Summary"
description: ${yamlQuote((summary.content ?? '').slice(0, 200))}
factType: summary
keywords: ${yamlQuote((summary.keywords ?? []).join(', '))}
source: legacy_migration
---
${summary.content ?? ''}
`
      writeFileSync(join(factsDir, `fact-summary-${idSlug}.md`), content, 'utf-8')
      count++
    }

    // Migrate rules — store as fact-type "rule" `.facts` files so they remain
    // searchable via the vector index.
    for (const rule of data.rules ?? []) {
      if (typeof rule !== 'string') continue
      const slug = slugify(rule)
      const content = `---
type: reference
title: ${yamlQuote(rule)}
description: "Migrated legacy rule"
factType: rule
source: legacy_migration
---
${rule}
`
      writeFileSync(join(factsDir, `fact-rule-${slug}.md`), content, 'utf-8')
      count++
    }

    // Preserve legacy relations as a single relation-set fact so the graph's
    // structure survives the migration (previously relations were silently
    // dropped on read-back).
    const relations: Relation[] = (data.relations ?? []).map((r: any) => ({
      sourceId: String(r.sourceId ?? ''),
      targetId: String(r.targetId ?? ''),
      type: String(r.type ?? 'related'),
    }))
    if (relations.length > 0) {
      const relContent = `---
type: reference
title: "Migrated Relations"
description: "Legacy knowledge-graph relations"
factType: relations
source: legacy_migration
relationCount: ${relations.length}
---
${relations.map(r => `${r.sourceId} => ${r.type} => ${r.targetId}`).join('\n')}
`
      writeFileSync(join(factsDir, `fact-relations-migrated.md`), relContent, 'utf-8')
      count++
    }

    // Guard is set only after all writes succeed.
    legacyMigrationDoneProjects.add(projectKey)
    console.error(`[knowledgeGraph] Migrated ${count} items from legacy store. Backup saved at ${backupPath}`)

    // Retire the live legacy sources so a fresh process does not remigrate
    // the same data and overwrite user edits under .facts/. The backup
    // created above is always available for recovery.
    if (existsSync(sourcePath)) {
      try { rmSync(sourcePath, { force: true }) } catch { /* non-fatal */ }
    }
  } catch (e) {
    console.error('[knowledgeGraph] Legacy migration failed during write phase. Backup preserved at:', backupPath, e)
    // Do NOT set legacyMigrationDoneProjects so migration is retried on next access.
  }
}

export function getGlobalGraph(): KnowledgeGraph {
  migrateLegacyKnowledgeGraph()
  const factsDir = getFactsDir()
  const entities: Record<string, Entity> = {}
  const relations: Relation[] = []
  const rules: string[] = []
  const summaries: SemanticSummary[] = []

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
          if (!fm?.title || typeof fm.title !== 'string') continue
          const factType = typeof fm.factType === 'string' ? fm.factType : 'fact'
          const id = `fact_${file}`

          if (factType === 'relations') {
            // Restore migrated relations from the relation-set fact.
            const relMatches = parsed.content.matchAll(/^(\S+)\s*=>\s*(.+?)\s*=>\s*(\S+)$/gm)
            for (const m of relMatches) {
              relations.push({ sourceId: m[1], targetId: m[3], type: m[2].trim() })
            }
            continue
          }

          if (factType === 'rule') {
            rules.push(fm.title)
            continue
          }

          if (factType === 'summary') {
            const keywords = typeof fm.keywords === 'string'
              ? fm.keywords.split(',').map(k => k.trim()).filter(Boolean)
              : []
            summaries.push({ id, content: parsed.content.trim(), keywords, timestamp: Date.now() })
          }

          // Preserve the full attributes block (including migrated legacy
          // attributes such as url/owner), not just the description.
          const attrs: Record<string, string> = {}
          if (fm.attributes && typeof fm.attributes === 'object') {
            for (const [k, v] of Object.entries(fm.attributes)) {
              attrs[k] = typeof v === 'string' ? v : String(v)
            }
          }
          if (fm.description && typeof fm.description === 'string') {
            attrs.description = fm.description
          }
          entities[id] = {
            id,
            type: factType,
            name: fm.title,
            attributes: attrs,
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
    relations,
    summaries,
    rules,
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
  // Ensure any legacy store is migrated before searching so users with only
  // a legacy JSON or SQLite graph receive their prior knowledge during normal
  // conversation, not only after invoking /knowledge status.
  migrateLegacyKnowledgeGraph()

  const memDir = getAutoMemPath()
  if (!memDir || !query) return ''

  try {
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
  // Atomically clear the legacy source so /knowledge clear does not
  // resurrect data via remigration on the next getGlobalGraph() call.
  const legacyPath = getLegacyGraphPath()
  if (existsSync(legacyPath)) {
    try {
      // Archive rather than delete so recovery is possible.
      const archived = `${legacyPath}.cleared-${Date.now()}`
      writeFileSync(archived, readFileSync(legacyPath))
      rmSync(legacyPath, { force: true })
    } catch { /* ignore */ }
  }
  const sqlitePath = getLegacySqlitePath()
  if (existsSync(sqlitePath)) {
    try {
      const archived = `${sqlitePath}.cleared-${Date.now()}`
      writeFileSync(archived, readFileSync(sqlitePath))
      rmSync(sqlitePath, { force: true })
    } catch { /* ignore */ }
  }
  // Legacy SQLite ran in WAL mode, so sensitive knowledge may remain in the
  // -wal/-shm sidecar files after the main db is removed. Archive/remove them
  // too, or /knowledge clear would report success while data persists.
  for (const sidecar of ['-wal', '-shm']) {
    const sidecarPath = `${sqlitePath}${sidecar}`
    if (existsSync(sidecarPath)) {
      try {
        const archived = `${sidecarPath}.cleared-${Date.now()}`
        writeFileSync(archived, readFileSync(sidecarPath))
        rmSync(sidecarPath, { force: true })
      } catch { /* ignore */ }
    }
  }
  // Reset the guard so that if the user re-enables the feature the cleared
  // state is authoritative — no remigration from deleted sources occurs.
  legacyMigrationDoneProjects.delete(currentProjectKey())
  clearIndex(memDir)
}

export function clearMemoryOnly(): void {
  // no-op: memdir is file-based, no in-memory cache to clear
}

/**
 * Knowledge Graph — compatibility layer over memdir.
 *
 * Previously maintained its own SQLite/JSON/Orama storage. Now delegates
 * to memdir for storage and vector search. The Entity/Relation/Summary
 * types are kept for backward compatibility; the actual data lives as
 * structured .md files in the auto-memory directory.
 */

import { readFileSync, existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { getAutoMemPath } from '../memdir/paths.js'
import { initMemdirIndex, searchMemdirIndex, clearIndex, getIndexPath, getIndexMetaPath } from '../memdir/vectorIndex.js'
import { parseFrontmatter } from './frontmatterParser.js'

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

export function getGlobalGraph(): KnowledgeGraph {
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
        const snippet = r.content?.trim().slice(0, 300)
        if (snippet) output += `\n  content: ${snippet.replace(/\n+/g, ' ').slice(0, 200)}`
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

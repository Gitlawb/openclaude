import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getProjectsDir } from './sessionStorage.js'
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
  rules: string[] // New: Persistent project-level rules
  lastUpdateTime: number
}

let projectGraph: KnowledgeGraph | null = null

function attributesContainAll(
  current: Record<string, string>,
  next: Record<string, string>,
): boolean {
  return Object.entries(next).every(([key, value]) => current[key] === value)
}

export function getProjectGraphPath(cwd: string): string {
  const projectDir = join(getProjectsDir(), sanitizePath(cwd))
  return join(projectDir, 'knowledge_graph.json')
}

export function loadProjectGraph(cwd: string): KnowledgeGraph {
  const path = getProjectGraphPath(cwd)
  let loadedGraph: KnowledgeGraph | null = null

  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      // Robust migration for all evolving fields
      if (!data.summaries) data.summaries = []
      if (!data.rules) data.rules = []
      loadedGraph = data
    } catch (e) {
      console.error(`Failed to load project graph from ${path}:`, e)
    }
  }

  // Use loaded data or default initial state
  projectGraph = loadedGraph || {
    entities: {},
    relations: [],
    summaries: [],
    rules: [],
    lastUpdateTime: Date.now(),
  }

  return projectGraph
}

export function saveProjectGraph(cwd: string): void {
  if (!projectGraph) return
  const path = getProjectGraphPath(cwd)
  try {
    const dir = join(getProjectsDir(), sanitizePath(cwd))
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, JSON.stringify(projectGraph, null, 2), 'utf-8')
  } catch (e) {
    console.error(`Failed to save project graph to ${path}:`, e)
  }
}

export function getGlobalGraph(): KnowledgeGraph {
  if (!projectGraph || (Object.keys(projectGraph.entities).length === 0 && projectGraph.summaries.length === 0)) {
    return loadProjectGraph(getFsImplementation().cwd())
  }
  return projectGraph
}

export function addGlobalEntity(
  type: string,
  name: string,
  attributes: Record<string, string> = {},
): Entity {
  const graph = getGlobalGraph()
  const existingEntity = Object.values(graph.entities).find(
    e => e.type === type && e.name === name,
  )

  if (existingEntity) {
    if (attributesContainAll(existingEntity.attributes, attributes)) {
      return existingEntity
    }

    existingEntity.attributes = { ...existingEntity.attributes, ...attributes }
    graph.lastUpdateTime = Date.now()
    saveProjectGraph(getFsImplementation().cwd())
    return existingEntity
  }

  const id = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const entity: Entity = { id, type, name, attributes }

  graph.entities[id] = entity
  graph.lastUpdateTime = Date.now()
  saveProjectGraph(getFsImplementation().cwd())
  return entity
}

export function addGlobalRelation(
  sourceId: string,
  targetId: string,
  type: string,
): void {
  const graph = getGlobalGraph()
  if (!graph.entities[sourceId] || !graph.entities[targetId]) {
    throw new Error('Source or target entity not found in graph')
  }

  graph.relations.push({ sourceId, targetId, type })
  graph.lastUpdateTime = Date.now()
  saveProjectGraph(getFsImplementation().cwd())
}

export function addGlobalSummary(content: string, keywords: string[]): void {
  const graph = getGlobalGraph()
  const id = `summary_${Date.now()}`
  graph.summaries.push({
    id,
    content,
    keywords: keywords.map(k => k.toLowerCase()),
    timestamp: Date.now(),
  })
  graph.lastUpdateTime = Date.now()
  saveProjectGraph(getFsImplementation().cwd())
}

export function addGlobalRule(rule: string): void {
  const graph = getGlobalGraph()
  if (!graph.rules.includes(rule)) {
    graph.rules.push(rule)
    graph.lastUpdateTime = Date.now()
    saveProjectGraph(getFsImplementation().cwd())
  }
}

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s,;:()\"'`?]+/)
    .filter(word => word.length >= 2)
    .map(word => {
       if (/^\d+\.\d+/.test(word)) return word;
       return word.replace(/\.$/g, '');
    })
    .filter(word => word.length >= 2);

  const extraWords: string[] = [];
  for (const w of words) {
    if (w.endsWith('s') && w.length > 3) {
      extraWords.push(w.slice(0, -1));
    }
  }

  return Array.from(new Set([...words, ...extraWords]));
}

/**
 * BM25-Lite Scoring:
 * Ranks a document based on keyword relevance and rarity.
 */
function calculateBM25Score(queryWords: string[], summary: SemanticSummary, allSummaries: SemanticSummary[]): number {
  let totalScore = 0
  const totalDocs = allSummaries.length || 1

  for (const word of queryWords) {
    const tf = summary.keywords.filter(k => k === word).length ||
               (summary.content.toLowerCase().includes(word) ? 1 : 0)

    const docsWithWord = allSummaries.filter(s =>
      s.keywords.includes(word) || s.content.toLowerCase().includes(word)
    ).length || 1

    const idf = Math.log((totalDocs - docsWithWord + 0.5) / (docsWithWord + 0.5) + 1)
    totalScore += idf * (tf * 2.2) / (tf + 1.2)
  }

  return totalScore
}

export function getOrchestratedMemory(query: string): string {
  const graph = getGlobalGraph()
  const queryWords = extractKeywords(query)

  if (queryWords.length === 0) {
    return getGlobalGraphSummary()
  }

  // Tier 1: Exact Entity Matches (High precision)
  const matchingEntities = Object.values(graph.entities)
    .filter(e => {
      const eName = e.name.toLowerCase();
      const eType = e.type.toLowerCase();
      const eAttrValues = Object.values(e.attributes).map(v => v.toLowerCase());

      return queryWords.some(qw =>
        eName.includes(qw) ||
        qw.includes(eName) ||
        eType.includes(qw) ||
        eAttrValues.some(v => v.includes(qw))
      )
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aAttrValues = Object.values(a.attributes).map(v => v.toLowerCase());
      const bAttrValues = Object.values(b.attributes).map(v => v.toLowerCase());

      const aPerfect = queryWords.some(qw => aName === qw || aAttrValues.some(av => av === qw)) ? 1 : 0
      const bPerfect = queryWords.some(qw => bName === qw || bAttrValues.some(av => av === qw)) ? 1 : 0

      if (aPerfect !== bPerfect) return bPerfect - aPerfect;

      // Recency boost: newer entities (higher timestamp in ID) rank higher
      const aTime = parseInt(a.id.split('_')[1]) || 0
      const bTime = parseInt(b.id.split('_')[1]) || 0
      if (Math.abs(aTime - bTime) > 1000) return bTime - aTime;

      const aSub = queryWords.some(qw => aName.includes(qw) || aAttrValues.some(av => av.includes(qw))) ? 1 : 0
      const bSub = queryWords.some(qw => bName.includes(qw) || bAttrValues.some(av => av.includes(qw))) ? 1 : 0
      return bSub - aSub;
    })
    .slice(0, 15)

  // Tier 2: BM25-ranked Summaries (Contextual History)
  const scoredSummaries = graph.summaries
    .map(s => ({ ...s, score: calculateBM25Score(queryWords, s, graph.summaries) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  let output = '\\n--- [PERSISTENT PROJECT MEMORY (NATIVE RAG)] ---\\n'

  if (graph.rules.length > 0) {
    output += 'Active Project Rules:\\n'
    graph.rules.forEach(r => output += `- ${r}\\n`)
  }

  if (matchingEntities.length > 0) {
    output += '\\nRelevant Technical Entities:\\n'
    for (const e of matchingEntities) {
      output += `- [${e.type}] ${e.name}: ${Object.entries(e.attributes).map(([k,v]) => `${k}: ${v}`).join(', ')}\\n`
    }
  }

  if (scoredSummaries.length > 0) {
    output += '\\nContextual Project History (Ranked):\\n'
    for (const s of scoredSummaries) {
      output += `- ${s.content}\\n`
    }
  }

  return output + '------------------------------------------------\\n'
}

export function searchGlobalGraph(query: string): string {
  const graph = getGlobalGraph()
  const queryWords = extractKeywords(query)

  if (queryWords.length === 0) return ''

  // 1. Search in Entities (High Precision)
  const matchingEntities = Object.values(graph.entities).filter(e =>
    queryWords.some(qw =>
      e.name.toLowerCase().includes(qw) ||
      qw.includes(e.name.toLowerCase()) ||
      Object.values(e.attributes).some(v => v.toLowerCase().includes(qw))
    )
  )

  // 2. Search in Summaries (Broad Recall)
  const scoredSummaries = graph.summaries.map(s => {
    const matches = queryWords.filter(qw =>
      s.content.toLowerCase().includes(qw) ||
      s.keywords.some(k => k.includes(qw) || qw.includes(k))
    )
    return { ...s, score: matches.length }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 10)

  if (matchingEntities.length === 0 && scoredSummaries.length === 0) return ''

  let result = '\\n--- Persistent Project Memory ---\\n'

  if (matchingEntities.length > 0) {
    result += 'Known Facts (from Knowledge Graph):\\n'
    for (const e of matchingEntities.slice(0, 15)) {
      result += `- [${e.type}] ${e.name}: ${Object.entries(e.attributes).map(([k,v]) => `${k}: ${v}`).join(', ')}\\n`
    }
  }

  if (scoredSummaries.length > 0) {
    result += 'Relevant Project History (Summaries):\\n'
    for (const s of scoredSummaries) {
      result += `- ${s.content}\\n`
    }
  }

  return result + '-------------------------------\\n'
}

export function getGlobalGraphSummary(): string {
  const graph = getGlobalGraph()
  const entities = Object.values(graph.entities)
  if (entities.length === 0 && graph.summaries.length === 0 && graph.rules.length === 0) {
    return ''
  }

  let summary = '\\nKnowledge Graph Snapshot (Most Recent):\\n'
  const recentEntities = entities
    .sort((a, b) => {
      const timeA = parseInt(a.id.split('_')[1]) || 0
      const timeB = parseInt(b.id.split('_')[1]) || 0
      return timeB - timeA
    })
    .slice(0, 10)

  for (const entity of recentEntities) {
    summary += `- [${entity.type}] ${entity.name}`
    const attrs = Object.entries(entity.attributes)
    if (attrs.length > 0) {
      summary += ` (${attrs.map(([k, v]) => `${k}: ${v}`).join(', ')})`
    }
    summary += '\\n'
  }

  if (graph.rules.length > 0) {
    summary += '\\nProject Rules:\\n'
    graph.rules.slice(0, 5).forEach(r => summary += `- ${r}\\n`)
  }

  return summary
}

export function resetGlobalGraph(): void {
  const cwd = getFsImplementation().cwd()
  const path = getProjectGraphPath(cwd)
  try {
    rmSync(path, { force: true })
  } catch { /* ignore */ }
  projectGraph = null;
}

/**
 * Resets the in-memory cache ONLY.
 * Does NOT delete the physical file from disk.
 * Used for simulating fresh process starts in tests.
 */
export function clearMemoryOnly(): void {
  projectGraph = null;
}

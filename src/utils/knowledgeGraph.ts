import { rmSync, renameSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getProjectsDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'
import { getFsImplementation } from './fsOperations.js'
import { create, insert, search, type Orama, remove, getByID } from '@orama/orama'
import { persist, restore } from '@orama/plugin-data-persistence'
import { AsyncLocalStorage } from 'async_hooks'
import { SQLiteProvider } from './storage/SQLiteProvider.js'
import { JSONProvider } from './storage/JSONProvider.js'
import { writeFileSyncAndFlush_DEPRECATED } from './file.js'

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

// Re-entrant locking using AsyncLocalStorage
const mutationLock = new AsyncLocalStorage<boolean>()
let mutationQueue: Promise<any> = Promise.resolve()

let projectGraph: KnowledgeGraph | null = null
let oramaDb: Orama<any> | null = null
let oramaInitPromise: Promise<void> | null = null

// Storage Providers (Cached per project directory to handle CWD changes)
const providerCache = new Map<string, { sqlite: SQLiteProvider; json: JSONProvider }>()

const ORAMA_SCHEMA = {
  id: 'string',
  type: 'string',
  name: 'string',
  content: 'string',
  attributes: 'string',
} as const

function getProviders(): { sqlite: SQLiteProvider; json: JSONProvider } {
  const cwd = getFsImplementation().cwd()
  const projectDir = join(getProjectsDir(), sanitizePath(cwd))
  
  let providers = providerCache.get(projectDir)
  if (!providers) {
    providers = {
      sqlite: new SQLiteProvider(projectDir),
      json: new JSONProvider(projectDir)
    }
    providerCache.set(projectDir, providers)
  }
  
  return providers
}

/**
 * Serializes all Knowledge Graph mutations (SQLite, JSON & Orama) to prevent race conditions.
 * Uses AsyncLocalStorage to support re-entrant calls without deadlocking.
 */
async function enqueueMutation<T>(fn: () => T | Promise<T>): Promise<T> {
  if (mutationLock.getStore()) {
    return fn()
  }
  
  const result = (async () => {
    await mutationQueue
    return mutationLock.run(true, fn)
  })()
  
  mutationQueue = result.then(
    () => {},
    () => {},
  )
  return result
}

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

export function getOramaPersistencePath(cwd: string): string {
  const projectDir = join(getProjectsDir(), sanitizePath(cwd))
  return join(projectDir, 'knowledge.orama')
}

async function isOramaInSync(graph: KnowledgeGraph): Promise<boolean> {
  if (!oramaDb) return false
  const doc = getByID(oramaDb, 'meta:sync')
  if (!doc) return false
  return (doc as any).content === graph.lastUpdateTime.toString()
}

async function updateOramaSyncMetadata(cwd: string, graph: KnowledgeGraph): Promise<void> {
  if (!oramaDb) return
  try {
    await remove(oramaDb, 'meta:sync')
  } catch { /* ignore if not found */ }
  
  await insert(oramaDb, {
    id: 'meta:sync',
    type: 'meta',
    name: 'sync',
    content: graph.lastUpdateTime.toString(),
    attributes: JSON.stringify({ lastUpdateTime: graph.lastUpdateTime })
  })
  await saveOrama(cwd)
}

/**
 * Initializes the Knowledge Subsystem (SQLite & Orama).
 * Self-healing: Prioritizes SQLite for speed, fallbacks to JSON if needed.
 */
export async function initOrama(cwd: string): Promise<void> {
  const providers = getProviders()

  const performInit = async () => {
    // 1. Initialize SQLite (Runtime-safe)
    await providers.sqlite.init()

    // 2. Load the base graph state if not already loaded
    if (!projectGraph) {
      loadProjectGraph(cwd)
    }

    // 3. Initialize Orama
    if (oramaDb) return

    const path = getOramaPersistencePath(cwd)
    let restored = false

    if (existsSync(path)) {
      try {
        const data = readFileSync(path)
        oramaDb = await restore('binary', data)
        const graph = projectGraph || loadProjectGraph(cwd)
        if (await isOramaInSync(graph)) {
          restored = true
        } else {
          oramaDb = null
        }
      } catch (e) {
        try {
          renameSync(path, `${path}.corrupted.${Date.now()}`)
        } catch { /* ignore */ }
      }
    }

    if (!restored) {
      oramaDb = await create({ schema: ORAMA_SCHEMA })
      const graph = projectGraph || loadProjectGraph(cwd)
      
      for (const entity of Object.values(graph.entities)) {
        try { await remove(oramaDb, entity.id) } catch {}
        await insert(oramaDb, {
          id: entity.id,
          type: entity.type,
          name: entity.name,
          content: entity.name,
          attributes: JSON.stringify(entity.attributes),
        })
      }
      for (const summary of graph.summaries) {
        try { await remove(oramaDb, summary.id) } catch {}
        await insert(oramaDb, {
          id: summary.id,
          type: 'summary',
          name: 'summary',
          content: summary.content,
          attributes: JSON.stringify({ keywords: summary.keywords }),
        })
      }
      await updateOramaSyncMetadata(cwd, graph)
    }
  }

  if (mutationLock.getStore()) {
    await performInit()
    return
  }

  if (oramaInitPromise) return oramaInitPromise
  oramaInitPromise = enqueueMutation(performInit)
  try {
    await oramaInitPromise
  } finally {
    oramaInitPromise = null
  }
}

export async function saveOrama(cwd: string): Promise<void> {
  if (!oramaDb) return
  const path = getOramaPersistencePath(cwd)
  try {
    const data = await persist(oramaDb, 'binary')
    // Atomic write with flush using established project utility
    writeFileSyncAndFlush_DEPRECATED(path, data as Buffer)
  } catch (e) {
    console.error('Failed to save Orama DB:', e)
  }
}

/**
 * Self-healing loader: Prioritizes the latest data by comparing
 * timestamps between JSON (Audit Log) and SQLite (Working Store).
 * Note: If SQLite is not yet initialized, it only uses JSON.
 */
export function loadProjectGraph(cwd: string): KnowledgeGraph {
  const { sqlite, json } = getProviders()
  
  const graphFromJson = json.loadGraph()
  const graphFromSqlite = sqlite.isReady ? sqlite.loadGraph() : null
  
  // Deterministic Choice: pick the one with the higher lastUpdateTime.
  // In case of equality, the JSON Audit Log wins as the ultimate Source of Truth.
  if (graphFromJson && graphFromSqlite) {
    if (graphFromSqlite.lastUpdateTime > graphFromJson.lastUpdateTime) {
      projectGraph = graphFromSqlite
      json.saveGraph(graphFromSqlite)
    } else {
      projectGraph = graphFromJson
      sqlite.saveGraph(graphFromJson)
    }
  } else if (graphFromJson) {
    projectGraph = graphFromJson
    if (sqlite.isReady) sqlite.saveGraph(graphFromJson)
  } else if (graphFromSqlite) {
    projectGraph = graphFromSqlite
    json.saveGraph(graphFromSqlite)
  } else {
    // Default initial state
    projectGraph = {
      entities: {},
      relations: [],
      summaries: [],
      rules: [],
      lastUpdateTime: Date.now(),
    }
  }

  return projectGraph
}

export function saveProjectGraph(cwd: string): void {
  if (!projectGraph) return
  const { sqlite, json } = getProviders()
  
  // Dual-Write strategy
  json.saveGraph(projectGraph)
  if (sqlite.isReady) sqlite.saveGraph(projectGraph)
}

export function getGlobalGraph(): KnowledgeGraph {
  const cwd = getFsImplementation().cwd()
  // Ensure we're using the correct project data for the current CWD
  if (
    !projectGraph ||
    (Object.keys(projectGraph.entities).length === 0 &&
      projectGraph.summaries.length === 0)
  ) {
    return loadProjectGraph(cwd)
  }
  return projectGraph
}

export async function addGlobalEntity(
  type: string,
  name: string,
  attributes: Record<string, string> = {},
): Promise<Entity> {
  return enqueueMutation(async () => {
    const cwd = getFsImplementation().cwd()
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
      saveProjectGraph(cwd)

      await initOrama(cwd)
      if (oramaDb) {
        try { await remove(oramaDb, existingEntity.id) } catch {}
        await insert(oramaDb, {
          id: existingEntity.id,
          type: existingEntity.type,
          name: existingEntity.name,
          content: existingEntity.name,
          attributes: JSON.stringify(existingEntity.attributes),
        })
        await updateOramaSyncMetadata(cwd, graph)
      }
      return existingEntity
    }

    const id = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const entity: Entity = { id, type, name, attributes }

    graph.entities[id] = entity
    graph.lastUpdateTime = Date.now()
    saveProjectGraph(cwd)

    await initOrama(cwd)
    if (oramaDb) {
      try { await remove(oramaDb, id) } catch {}
      await insert(oramaDb, {
        id,
        type,
        name,
        content: name,
        attributes: JSON.stringify(attributes),
      })
      await updateOramaSyncMetadata(cwd, graph)
    }

    return entity
  })
}

export async function addGlobalRelation(
  sourceId: string,
  targetId: string,
  type: string,
): Promise<void> {
  return enqueueMutation(async () => {
    const graph = getGlobalGraph()
    if (!graph.entities[sourceId] || !graph.entities[targetId]) {
      throw new Error('Source or target entity not found in graph')
    }

    graph.relations.push({ sourceId, targetId, type })
    graph.lastUpdateTime = Date.now()
    const cwd = getFsImplementation().cwd()
    saveProjectGraph(cwd)

    await initOrama(cwd)
    if (oramaDb) {
      await updateOramaSyncMetadata(cwd, graph)
    }
  })
}

export async function addGlobalSummary(
  content: string,
  keywords: string[],
): Promise<void> {
  return enqueueMutation(async () => {
    const cwd = getFsImplementation().cwd()
    const graph = getGlobalGraph()
    const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    graph.summaries.push({
      id,
      content,
      keywords: keywords.map(k => k.toLowerCase()),
      timestamp: Date.now(),
    })
    graph.lastUpdateTime = Date.now()
    saveProjectGraph(cwd)

    await initOrama(cwd)
    if (oramaDb) {
      try { await remove(oramaDb, id) } catch {}
      await insert(oramaDb, {
        id,
        type: 'summary',
        name: 'summary',
        content,
        attributes: JSON.stringify({ keywords }),
      })
      await updateOramaSyncMetadata(cwd, graph)
    }
  })
}

export async function addGlobalRule(rule: string): Promise<void> {
  return enqueueMutation(async () => {
    const graph = getGlobalGraph()
    if (!graph.rules.includes(rule)) {
      graph.rules.push(rule)
      graph.lastUpdateTime = Date.now()
      const cwd = getFsImplementation().cwd()
      saveProjectGraph(cwd)

      await initOrama(cwd)
      if (oramaDb) {
        await updateOramaSyncMetadata(cwd, graph)
      }
    }
  })
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

export async function getOrchestratedMemory(query: string): Promise<string> {
  const graph = getGlobalGraph()
  const queryWords = extractKeywords(query)

  if (queryWords.length === 0) {
    return getGlobalGraphSummary()
  }

  await initOrama(getFsImplementation().cwd())
  
  if (oramaDb) {
    try {
      const results = await search(oramaDb, { term: query, limit: 20 })
      let visibleHits = 0
      let hitsContent = ''

      if (results.count > 0) {
        for (const hit of results.hits) {
          const doc = hit.document as any
          if (doc.id === 'meta:sync') continue
          
          visibleHits++
          if (doc.type === 'summary') {
            hitsContent += `- ${doc.content}\n`
          } else {
            try {
              const attrs = JSON.parse(doc.attributes)
              hitsContent += `- [${doc.type}] ${doc.name}: ${Object.entries(attrs)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')}\n`
            } catch {
              hitsContent += `- [${doc.type}] ${doc.name}: ${doc.attributes}\n`
            }
          }
        }
      }

      if (visibleHits > 0) {
        let output = '\n--- [PERSISTENT PROJECT MEMORY (ORAMA RAG)] ---\n'
        if (graph.rules.length > 0) {
          output += 'Active Project Rules:\n'
          graph.rules.forEach(r => (output += `- ${r}\n`))
          output += '\n'
        }
        output += 'Relevant Technical Entities & History:\n'
        output += hitsContent
        return output + '------------------------------------------------\n'
      }
    } catch (e) {
      console.error('Orama search failed, falling back to native search:', e)
    }
  }

  const matchingEntities = Object.values(graph.entities)
    .filter(e => {
      const eName = e.name.toLowerCase()
      const eType = e.type.toLowerCase()
      const eAttrValues = Object.values(e.attributes).map(v => v.toLowerCase())

      return queryWords.some(
        qw =>
          eName.includes(qw) ||
          qw.includes(eName) ||
          eType.includes(qw) ||
          eAttrValues.some(v => v.includes(qw)),
      )
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      const aAttrValues = Object.values(a.attributes).map(v => v.toLowerCase())
      const bAttrValues = Object.values(b.attributes).map(v => v.toLowerCase())

      const aPerfect = queryWords.some(qw => aName === qw || aAttrValues.some(av => av === qw)) ? 1 : 0
      const bPerfect = queryWords.some(qw => bName === qw || bAttrValues.some(av => av === qw)) ? 1 : 0
      if (aPerfect !== bPerfect) return bPerfect - aPerfect

      const aTime = parseInt(a.id.split('_')[1]) || 0
      const bTime = parseInt(b.id.split('_')[1]) || 0
      if (Math.abs(aTime - bTime) > 1000) return bTime - aTime

      const aSub = queryWords.some(qw => aName.includes(qw) || aAttrValues.some(av => av.includes(qw))) ? 1 : 0
      const bSub = queryWords.some(qw => bName.includes(qw) || bAttrValues.some(av => av.includes(qw))) ? 1 : 0
      return bSub - aSub
    })
    .slice(0, 15)

  const scoredSummaries = graph.summaries
    .map(s => ({ ...s, score: calculateBM25Score(queryWords, s, graph.summaries) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  if (matchingEntities.length > 0 || scoredSummaries.length > 0) {
    let output = '\n--- [PERSISTENT PROJECT MEMORY (NATIVE RAG)] ---\n'
    if (graph.rules.length > 0) {
      output += 'Active Project Rules:\n'
      graph.rules.forEach(r => (output += `- ${r}\n`))
      output += '\n'
    }

    if (matchingEntities.length > 0) {
      output += 'Relevant Technical Entities:\n'
      for (const e of matchingEntities) {
        output += `- [${e.type}] ${e.name}: ${Object.entries(e.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`
      }
      if (scoredSummaries.length > 0) output += '\n'
    }

    if (scoredSummaries.length > 0) {
      output += 'Contextual Project History (Ranked):\n'
      for (const s of scoredSummaries) {
        output += `- ${s.content}\n`
      }
    }
    return output + '------------------------------------------------\n'
  }

  return ''
}

export async function searchGlobalGraph(query: string): Promise<string> {
  const queryWords = extractKeywords(query)
  if (queryWords.length === 0) return ''
  return getOrchestratedMemory(query)
}

export function getGlobalGraphSummary(): string {
  const graph = getGlobalGraph()
  const entities = Object.values(graph.entities)
  if (entities.length === 0 && graph.summaries.length === 0 && graph.rules.length === 0) return ''

  let summary = '\nKnowledge Graph Snapshot (Most Recent):\n'
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
    summary += '\n'
  }

  if (graph.rules.length > 0) {
    summary += '\nProject Rules:\n'
    graph.rules.slice(0, 5).forEach(r => (summary += `- ${r}\n`))
  }

  return summary
}

export function resetGlobalGraph(): void {
  const cwd = getFsImplementation().cwd()
  const { sqlite, json } = getProviders()
  
  json.delete()
  sqlite.close()
  
  const projectDir = join(getProjectsDir(), sanitizePath(cwd))
  const sqlitePath = join(projectDir, 'knowledge.db')
  if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true })
  
  const oramaPath = getOramaPersistencePath(cwd)
  try { rmSync(oramaPath, { force: true }) } catch {}
  
  oramaDb = null
  projectGraph = null
  // Clear cache for this specific project
  providerCache.delete(projectDir)
}

export function clearMemoryOnly(): void {
  const cwd = getFsImplementation().cwd()
  const projectDir = join(getProjectsDir(), sanitizePath(cwd))
  const providers = providerCache.get(projectDir)
  
  projectGraph = null
  oramaDb = null
  if (providers) {
    providers.sqlite.close()
    providerCache.delete(projectDir)
  }
}

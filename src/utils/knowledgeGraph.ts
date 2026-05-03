import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { homedir } from 'os'

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

export interface KnowledgeGraph {
  entities: Record<string, Entity>
  relations: Relation[]
  summaries: string[]
  rules: string[]
  lastUpdateTime: number
}

/**
 * Universal SQLite Database Wrapper
 */
class UniversalDB {
  private inner: any
  private isBun: boolean

  constructor(path: string, isBun: boolean, inner: any) {
    this.inner = inner
    this.isBun = isBun
  }

  run(sql: string, ...params: any[]): void {
    if (this.isBun) {
      this.inner.run(sql, ...params)
    } else {
      this.inner.prepare(sql).run(...params)
    }
  }

  exec(sql: string): void {
    if (this.isBun) {
      this.inner.run(sql)
    } else {
      this.inner.exec(sql)
    }
  }

  queryAll(sql: string, ...params: any[]): any[] {
    if (this.isBun) {
      return this.inner.query(sql).all(...params)
    } else {
      return this.inner.prepare(sql).all(...params)
    }
  }

  queryOne(sql: string, ...params: any[]): any {
    if (this.isBun) {
      return this.inner.query(sql).get(...params)
    } else {
      return this.inner.prepare(sql).get(...params)
    }
  }

  close(): void {
    this.inner.close()
  }
}

interface ProjectContext {
  db: UniversalDB
  orama: any // AnyOrama - Lazy loaded
  saveTimeout?: any
  lastUpdateTime: number
}

const activeContexts = new Map<string, ProjectContext>()
let initPromise: Promise<void> | null = null

function getInternalConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

function getProjectDbPath(cwd: string): string {
  const sanitized = cwd.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  return join(getInternalConfigDir(), 'projects', sanitized, 'knowledge.db')
}

function getProjectOramaPath(cwd: string): string {
  const sanitized = cwd.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  return join(getInternalConfigDir(), 'projects', sanitized, 'knowledge.orama.json')
}

async function getContext(cwd: string): Promise<ProjectContext | null> {
  // Defensive check for test environment pollution
  if (process.env.BUN_TEST && !process.env.OPENCLAUDE_TEST_KNOWLEDGE) return null

  while (initPromise) await initPromise
  let context = activeContexts.get(cwd)
  if (context) return context
  let resolveInit: () => void
  initPromise = new Promise(resolve => { resolveInit = resolve })
  try {
    const dbPath = getProjectDbPath(cwd); const oramaPath = getProjectOramaPath(cwd)
    const dir = dirname(dbPath); if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    let db: UniversalDB
    // @ts-ignore
    if (typeof Bun !== 'undefined') {
      const { Database } = await import('bun:sqlite')
      db = new UniversalDB(dbPath, true, new Database(dbPath, { create: true }))
    } else {
      const Database = (await import('better-sqlite3')).default
      db = new UniversalDB(dbPath, false, new Database(dbPath))
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, type TEXT, name TEXT, attributes TEXT, last_updated INTEGER);
      CREATE TABLE IF NOT EXISTS relations (source_id TEXT, target_id TEXT, type TEXT, FOREIGN KEY(source_id) REFERENCES entities(id), FOREIGN KEY(target_id) REFERENCES entities(id));
      CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, content TEXT, keywords TEXT, timestamp INTEGER);
      CREATE TABLE IF NOT EXISTS rules (rule TEXT PRIMARY KEY, timestamp INTEGER);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_summaries_timestamp ON summaries(timestamp);
    `)
    let orama: any
    if (existsSync(oramaPath)) { try { const { restore } = await import('@orama/plugin-data-persistence'); const data = readFileSync(oramaPath, 'utf-8'); orama = await restore('json', data) } catch { orama = await createOramaIndex() } } else { orama = await createOramaIndex() }
    context = { db, orama, lastUpdateTime: Date.now() }; activeContexts.set(cwd, context); return context
  } finally { initPromise = null; resolveInit!() }
}

async function createOramaIndex() {
  const { create } = await import('@orama/orama')
  return await create({ schema: { id: 'string', text: 'string', type: 'string', embedding: 'vector[1536]' } })
}

function scheduleOramaSave(cwd: string): void {
  const context = activeContexts.get(cwd); if (!context) return
  if (context.saveTimeout) clearTimeout(context.saveTimeout)
  context.saveTimeout = setTimeout(async () => {
    const oramaPath = getProjectOramaPath(cwd)
    try { const { persist } = await import('@orama/plugin-data-persistence'); const data = await persist(context.orama, 'json'); writeFileSync(oramaPath, data as string); context.saveTimeout = undefined } catch (e) { console.error(`[Knowledge] Failed to save Orama index for ${cwd}:`, e) }
  }, 5000)
}

export async function addGlobalEntity(type: string, name: string, attributes: Record<string, string> = {}): Promise<Entity | null> {
  const cwd = process.cwd(); const context = await getContext(cwd); if (!context) return null
  const { db, orama } = context; context.lastUpdateTime = Date.now()
  const existing = db.queryOne('SELECT * FROM entities WHERE type = ? AND name = ?', type, name)
  if (existing) {
    const currentAttrs = JSON.parse(existing.attributes); const mergedAttrs = { ...currentAttrs, ...attributes }
    db.run('UPDATE entities SET attributes = ?, last_updated = ? WHERE id = ?', JSON.stringify(mergedAttrs), Date.now(), existing.id)
    return { id: existing.id, type, name, attributes: mergedAttrs }
  }
  const id = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  db.run('INSERT INTO entities (id, type, name, attributes, last_updated) VALUES (?, ?, ?, ?, ?)', id, type, name, JSON.stringify(attributes), Date.now())
  const textToEmbed = `[${type}] ${name}: ${Object.entries(attributes).map(([k,v]) => `${k}:${v}`).join(' ')}`
  const { generateEmbedding } = await import('./embeddings.js')
  generateEmbedding(textToEmbed).then(async vector => { if (vector) { const { insert } = await import('@orama/orama'); await insert(orama, { id, text: textToEmbed, type: 'entity', embedding: vector }); scheduleOramaSave(cwd) } }).catch(() => {})
  return { id, type, name, attributes }
}

export async function addGlobalRelation(sourceId: string, targetId: string, type: string): Promise<void> {
  const cwd = process.cwd(); const context = await getContext(cwd); if (!context) return
  const sourceExists = context.db.queryOne('SELECT id FROM entities WHERE id = ?', sourceId)
  const targetExists = context.db.queryOne('SELECT id FROM entities WHERE id = ?', targetId)
  if (!sourceExists || !targetExists) throw new Error('Source or target entity not found in graph')
  context.db.run('INSERT INTO relations (source_id, target_id, type) VALUES (?, ?, ?)', sourceId, targetId, type)
  context.lastUpdateTime = Date.now()
}

export async function addGlobalSummary(content: string, keywords: string[]): Promise<void> {
  const cwd = process.cwd(); const context = await getContext(cwd); if (!context) return
  const { db, orama } = context; const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; context.lastUpdateTime = Date.now()
  db.run('INSERT INTO summaries (id, content, keywords, timestamp) VALUES (?, ?, ?, ?)', id, content, JSON.stringify(keywords.map(k => k.toLowerCase())), Date.now())
  const { generateEmbedding } = await import('./embeddings.js')
  generateEmbedding(content).then(async vector => { if (vector) { const { insert } = await import('@orama/orama'); await insert(orama, { id, text: content, type: 'summary', embedding: vector }); scheduleOramaSave(cwd) } }).catch(() => {})
}

export async function addGlobalRule(rule: string): Promise<void> {
  const cwd = process.cwd(); const context = await getContext(cwd); if (!context) return
  context.db.run('INSERT OR IGNORE INTO rules (rule, timestamp) VALUES (?, ?)', rule, Date.now()); context.lastUpdateTime = Date.now()
}

export function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9.-]+/).filter(word => word.length >= 2)
    .map(word => word.replace(/\.$/g, '')).filter(word => word.length >= 2);
  const extraWords: string[] = [];
  for (const w of words) if (w.endsWith('s') && w.length > 3) extraWords.push(w.slice(0, -1));
  return Array.from(new Set([...words, ...extraWords]));
}

export async function getGlobalGraph(): Promise<KnowledgeGraph> {
  const cwd = process.cwd(); const context = await getContext(cwd)
  if (!context) return { entities: {}, relations: [], summaries: [], rules: [], lastUpdateTime: 0 }
  const entitiesArr = context.db.queryAll('SELECT * FROM entities'); const entities: Record<string, Entity> = {}
  for (const e of entitiesArr) { entities[e.id] = { id: e.id, type: e.type, name: e.name, attributes: JSON.parse(e.attributes) } }
  const relations = context.db.queryAll('SELECT source_id as sourceId, target_id as targetId, type FROM relations')
  const summaries = context.db.queryAll('SELECT content FROM summaries').map((s: any) => s.content)
  const rules = context.db.queryAll('SELECT rule FROM rules').map((r: any) => r.rule)
  return { entities, relations, summaries, rules, lastUpdateTime: context.lastUpdateTime }
}

export async function consolidateKnowledge(cwd: string): Promise<void> {
  const context = await getContext(cwd); if (!context) return
  const entities = context.db.queryAll('SELECT * FROM entities ORDER BY last_updated DESC LIMIT 50')
  if (entities.length < 10) return
  const { getAnthropicClient } = await import('../services/api/client.js')
  const client = await getAnthropicClient({})
  const { getSmallFastModel } = await import('./model/model.js')
  const prompt = `Consolidate these technical entities into high-level rules. Data: ${JSON.stringify(entities.map((e: any) => ({ type: e.type, name: e.name })))}`
  try {
    const response = await client.messages.create({ model: getSmallFastModel(), max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    const insight = (response.content[0] as any).text; if (insight) await addGlobalRule(`Architectural Insight: ${insight}`)
  } catch {}
}

export async function getOrchestratedMemory(query: string, tokenLimit: number = 800): Promise<string> {
  const cwd = process.cwd(); const context = await getContext(cwd); if (!context) return ''
  const { db, orama } = context; const queryWords = extractKeywords(query)
  const { encodingForModel } = await import('js-tiktoken')
  const encoder = encodingForModel('gpt-4o')
  let output = '\n--- [PERSISTENT PROJECT MEMORY (HYBRID RAG)] ---\n'; let currentTokens = encoder.encode(output).length
  const rules = db.queryAll('SELECT rule FROM rules ORDER BY timestamp DESC LIMIT 10')
  if (rules.length > 0) {
    output += 'Active Project Rules:\n'
    for (const r of rules) {
      const line = `- ${r.rule}\n`; const tokens = encoder.encode(line).length
      if (currentTokens + tokens > tokenLimit * 0.3) break
      output += line; currentTokens += tokens
    }
  }
  const seenContent = new Set<string>(); const finalMatches: { text: string; score: number }[] = []
  const { generateEmbedding } = await import('./embeddings.js')
  const vector = await generateEmbedding(query)
  if (vector) {
    try {
      const { search } = await import('@orama/orama')
      const results = await search(orama, { mode: 'vector', vector: { value: vector, property: 'embedding' }, limit: 15 })
      for (const hit of results.hits) { const text = (hit.document as any).text; finalMatches.push({ text, score: hit.score * 5.0 }); seenContent.add(text) }
    } catch {}
  }
  const summaries = db.queryAll('SELECT content, keywords FROM summaries ORDER BY timestamp DESC LIMIT 100')
  for (const s of summaries) {
    if (seenContent.has(s.content)) continue
    let kwScore = 0; const kwArr = JSON.parse(s.keywords) as string[]
    for (const word of queryWords) { if (s.content.toLowerCase().includes(word)) kwScore += 1.0; if (kwArr.includes(word)) kwScore += 2.0 }
    if (kwScore > 0) { finalMatches.push({ text: s.content, score: kwScore }); seenContent.add(s.content) }
  }
  finalMatches.sort((a, b) => b.score - a.score)
  output += '\nRelevant Contextual Insights:\n'
  for (const m of finalMatches) {
    const line = `- ${m.text}\n`; const tokens = encoder.encode(line).length
    if (currentTokens + tokens > tokenLimit) break
    output += line; currentTokens += tokens
  }
  return output + '------------------------------------------------\n'
}

export async function searchGlobalGraph(query: string): Promise<string> { return await getOrchestratedMemory(query) }

export async function getGlobalGraphSummary(): Promise<string> {
  const context = await getContext(process.cwd()); if (!context) return ''
  const { db } = context
  const entities = db.queryAll('SELECT * FROM entities ORDER BY last_updated DESC LIMIT 10')
  const rules = db.queryAll('SELECT rule FROM rules ORDER BY timestamp DESC LIMIT 5')
  const summaries = db.queryAll('SELECT content FROM summaries ORDER BY timestamp DESC LIMIT 5')
  if (entities.length === 0 && rules.length === 0 && summaries.length === 0) return ''
  let summary = '\n--- Full Project Knowledge Graph ---\n'
  for (const e of entities) {
    const attrs = JSON.parse(e.attributes)
    summary += `- [${e.type}] ${e.name.length > 50 ? e.name.slice(0, 47) + '...' : e.name}: ${Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`
  }
  if (rules.length > 0) { summary += '\nActive Project Rules:\n'; rules.forEach((r: any) => summary += `- ${r.rule}\n`) }
  if (summaries.length > 0) { summary += '\nProject Knowledge Map:\n'; summaries.forEach((s: any) => summary += `- ${s.content}\n`) }
  return summary
}

export async function resetGlobalGraph(): Promise<void> {
  const cwd = process.cwd(); const context = activeContexts.get(cwd)
  if (context) { if (context.saveTimeout) clearTimeout(context.saveTimeout); try { context.db.close() } catch {}; activeContexts.delete(cwd) }
  const dbPath = getProjectDbPath(cwd); const oramaPath = getProjectOramaPath(cwd)
  if (existsSync(dbPath)) rmSync(dbPath, { force: true }); if (existsSync(oramaPath)) rmSync(oramaPath, { force: true })
}

export function clearMemoryOnly(): void {
  for (const [cwd, context] of activeContexts.entries()) { if (context.saveTimeout) clearTimeout(context.saveTimeout); try { context.db.close() } catch {} }
  activeContexts.clear()
}

import { describe, expect, it, beforeEach, afterEach, afterAll } from 'bun:test'
import {
  addGlobalEntity,
  addGlobalRelation,
  addGlobalSummary,
  searchGlobalGraph,
  loadProjectGraph,
  getProjectGraphPath,
  resetGlobalGraph,
  clearMemoryOnly,
  saveProjectGraph
} from './knowledgeGraph.js'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFsImplementation } from './fsOperations.js'
import { sanitizePath } from './sessionStoragePortable.js'
import { getProjectsDir } from './envUtils.js'

describe('KnowledgeGraph Global Persistence & RAG', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-knowledge-graph-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  const cwd = getFsImplementation().cwd()
  const graphPath = getProjectGraphPath(cwd)

  beforeEach(() => {
    resetGlobalGraph()
    rmSync(graphPath, { force: true })
  })

  afterEach(() => {
    rmSync(graphPath, { force: true })
  })

  afterAll(() => {
    resetGlobalGraph()
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    rmSync(configDir, { recursive: true, force: true })
  })

  it('persists entities across loads', async () => {
    await addGlobalEntity('server', 'prod-1', { ip: '1.2.3.4' })
    saveProjectGraph(cwd)

    // Reset singleton and reload
    clearMemoryOnly()
    const graph = loadProjectGraph(cwd)
    const entity = Object.values(graph.entities).find(e => e.name === 'prod-1')
    expect(entity).toBeDefined()
    expect(entity?.attributes.ip).toBe('1.2.3.4')
  })

  it('performs keyword-based RAG search', async () => {
    await addGlobalSummary('The database uses PostgreSQL version 15.', ['database', 'postgres', 'sql'])
    await addGlobalSummary('The frontend is built with React and Tailwind.', ['frontend', 'react', 'css'])

    const result = await searchGlobalGraph('Tell me about the database setup')
    expect(result).toContain('PostgreSQL')

    const result2 = await searchGlobalGraph('What react components are used?')
    expect(result2).toContain('React')
  })

  it('deduplicates entities and updates attributes', async () => {
    await addGlobalEntity('tool', 'openclaude', { status: 'alpha' })
    await addGlobalEntity('tool', 'openclaude', { status: 'beta', version: '0.6.0' })

    const graph = loadProjectGraph(cwd)
    const entities = Object.values(graph.entities).filter(e => e.name === 'openclaude')
    expect(entities.length).toBe(1)
    expect(entities[0].attributes.status).toBe('beta')
    expect(entities[0].attributes.version).toBe('0.6.0')
  })

  describe('Feature Flag: OPENCLAUDE_KNOWLEDGE_ORAMA', () => {
    it('uses Orama when flag is enabled', async () => {
      process.env.OPENCLAUDE_KNOWLEDGE_ORAMA = '1'
      const oramaPath = join(getProjectsDir(), sanitizePath(cwd), 'knowledge.orama')

      await addGlobalEntity('test', 'orama-active', { val: 'yes' })
      expect(existsSync(oramaPath)).toBe(true)

      const result = await searchGlobalGraph('orama-active')
      expect(result).toContain('ORAMA RAG')
      expect(result).toContain('orama-active')

      delete process.env.OPENCLAUDE_KNOWLEDGE_ORAMA
    })

    it('restores Orama from persistence file', async () => {
      process.env.OPENCLAUDE_KNOWLEDGE_ORAMA = '1'

      // First run: add and save
      await addGlobalEntity('test', 'persistent-orama', { data: '42' })
      clearMemoryOnly() // Reset in-memory oramaDb cache

      // Second run: search (should trigger restore)
      const result = await searchGlobalGraph('persistent-orama')
      expect(result).toContain('ORAMA RAG')
      expect(result).toContain('persistent-orama')

      delete process.env.OPENCLAUDE_KNOWLEDGE_ORAMA
    })

    it('stays on JSON path when flag is disabled', async () => {
      delete process.env.OPENCLAUDE_KNOWLEDGE_ORAMA
      const oramaPath = join(getProjectsDir(), sanitizePath(cwd), 'knowledge.orama')

      // Ensure clean state: remove orama file if it exists from previous tests
      if (existsSync(oramaPath)) rmSync(oramaPath)

      await addGlobalEntity('test', 'json-only', { val: 'yes' })
      expect(existsSync(oramaPath)).toBe(false)

      const result = await searchGlobalGraph('json-only')
      expect(result).not.toContain('ORAMA RAG')
      expect(result).toContain('json-only')
    })
  })
})

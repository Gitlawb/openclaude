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
} from './knowledgeGraph.js'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getProjectsDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'

describe('KnowledgeGraph Global Persistence & RAG', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-test-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  const cwd = process.cwd()

  beforeEach(() => {
    resetGlobalGraph()
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
    await addGlobalEntity('tool', 'openclaude', { status: 'alpha' })
    const path = getProjectGraphPath(cwd)
    expect(existsSync(path)).toBe(true)

    // Clear cache and reload
    clearMemoryOnly()
    const graph = loadProjectGraph(cwd)
    const entities = Object.values(graph.entities).filter(e => e.name === 'openclaude')
    expect(entities.length).toBe(1)
    expect(entities[0].attributes.status).toBe('alpha')
  })

  it('performs keyword-based RAG search', async () => {
    await addGlobalSummary('The database uses PostgreSQL version 15.', ['database', 'postgres', 'sql'])
    await addGlobalSummary('The frontend is built with React and Tailwind.', ['frontend', 'react', 'css'])

    const result = await searchGlobalGraph('PostgreSQL')
    expect(result.toLowerCase()).toContain('database')
    expect(result.toLowerCase()).toContain('postgresql')
    expect(result.toLowerCase()).not.toContain('react')
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

  it('clears Orama database and persistence file on resetGlobalGraph', async () => {
    const { initOrama, getOramaPersistencePath } = await import('./knowledgeGraph.js')

    await initOrama(cwd)
    await addGlobalSummary('Orama test summary', ['orama'])

    const oramaPath = getOramaPersistencePath(cwd)
    expect(require('fs').existsSync(oramaPath)).toBe(true)

    resetGlobalGraph()
    expect(require('fs').existsSync(oramaPath)).toBe(false)
  })

  describe('Hybrid Architecture: Orama + JSON', () => {
    it('creates Orama persistence by default', async () => {
      const oramaPath = join(getProjectsDir(), sanitizePath(cwd), 'knowledge.orama')

      // Ensure clean state: remove orama file if it exists from previous tests
      if (existsSync(oramaPath)) rmSync(oramaPath)
      clearMemoryOnly()

      await addGlobalEntity('test', 'orama-active', { val: 'yes' })
      expect(existsSync(oramaPath)).toBe(true)

      const result = await searchGlobalGraph('orama-active')
      expect(result).toContain('ORAMA RAG')
      expect(result).toContain('orama-active')
    })

    it('restores Orama from persistence file', async () => {
      // First run: add and save
      await addGlobalEntity('test', 'persistent-orama', { data: '42' })
      clearMemoryOnly() // Reset in-memory oramaDb cache

      // Second run: search (should trigger restore)
      const result = await searchGlobalGraph('persistent-orama')
      expect(result).toContain('ORAMA RAG')
      expect(result).toContain('persistent-orama')
    })

    it('rebuilds Orama from JSON if persistence is missing', async () => {
      const oramaPath = join(getProjectsDir(), sanitizePath(cwd), 'knowledge.orama')
      
      // 1. Add data via standard hybrid path
      await addGlobalEntity('type', 'rebuild-test', { status: 'ok' })
      expect(existsSync(oramaPath)).toBe(true)
      
      // 2. Kill memory and delete Orama file, but keep JSON
      clearMemoryOnly()
      rmSync(oramaPath)
      expect(existsSync(oramaPath)).toBe(false)
      
      // 3. Search should trigger self-healing rebuild from JSON
      const result = await searchGlobalGraph('rebuild-test')
      expect(result).toContain('ORAMA RAG')
      expect(result).toContain('rebuild-test')
      expect(existsSync(oramaPath)).toBe(true)
    })

    it('returns an empty string for no-hit searches even if rules exist', async () => {
      const { addGlobalRule } = await import('./knowledgeGraph.js')
      resetGlobalGraph()
      await addGlobalRule('Always use TypeScript.')
      
      const result = await searchGlobalGraph('definitely-no-memory-matches')
      expect(result).toBe('')
    })
  })
})

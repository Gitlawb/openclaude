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
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFsImplementation } from './fsOperations.js'

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

  it('persists entities across loads', () => {
    addGlobalEntity('server', 'prod-1', { ip: '1.2.3.4' })
    saveProjectGraph(cwd)

    // Reset singleton and reload
    clearMemoryOnly()
    const graph = loadProjectGraph(cwd)
    const entity = Object.values(graph.entities).find(e => e.name === 'prod-1')
    expect(entity).toBeDefined()
    expect(entity?.attributes.ip).toBe('1.2.3.4')
  })

  it('performs keyword-based RAG search', () => {
    addGlobalSummary('The database uses PostgreSQL version 15.', ['database', 'postgres', 'sql'])
    addGlobalSummary('The frontend is built with React and Tailwind.', ['frontend', 'react', 'css'])

    const result = searchGlobalGraph('Tell me about the database setup')
    expect(result).toContain('PostgreSQL')

    const result2 = searchGlobalGraph('What react components are used?')
    expect(result2).toContain('React')
  })

  it('deduplicates entities and updates attributes', () => {
    addGlobalEntity('tool', 'openclaude', { status: 'alpha' })
    addGlobalEntity('tool', 'openclaude', { status: 'beta', version: '0.6.0' })

    const graph = loadProjectGraph(cwd)
    const entities = Object.values(graph.entities).filter(e => e.name === 'openclaude')
    expect(entities.length).toBe(1)
    expect(entities[0].attributes.status).toBe('beta')
    expect(entities[0].attributes.version).toBe('0.6.0')
  })
})

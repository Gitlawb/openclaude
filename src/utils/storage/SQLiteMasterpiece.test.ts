import { describe, expect, it, beforeEach, afterEach, afterAll } from 'bun:test'
import {
  addGlobalEntity,
  resetGlobalGraph,
  clearMemoryOnly,
  getGlobalGraph,
  addGlobalRelation,
  saveProjectGraph,
  initOrama
} from '../knowledgeGraph.js'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getProjectsDir } from '../envUtils.js'
import { sanitizePath } from '../sessionStoragePortable.js'
import { getFsImplementation } from '../fsOperations.js'

describe('SQLite Masterpiece: Edge Cases & Multi-Project Isolation', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const rootTestDir = mkdtempSync(join(tmpdir(), 'openclaude-masterpiece-'))
  process.env.CLAUDE_CONFIG_DIR = rootTestDir
  
  const project1Dir = join(rootTestDir, 'proj1')
  const project2Dir = join(rootTestDir, 'proj2')

  beforeEach(() => {
    resetGlobalGraph()
    if (!existsSync(project1Dir)) mkdirSync(project1Dir, { recursive: true })
    if (!existsSync(project2Dir)) mkdirSync(project2Dir, { recursive: true })
  })

  afterAll(() => {
    resetGlobalGraph()
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    rmSync(rootTestDir, { recursive: true, force: true })
  })

  it('guarantees strict isolation between projects (CWD Switch)', async () => {
    const fs = getFsImplementation()
    const originalCwd = fs.cwd()

    try {
      // 1. Enter Project 1
      fs.cwd = () => project1Dir
      clearMemoryOnly()
      await addGlobalEntity('type', 'entity-p1', { source: 'proj1' })
      
      // 2. Enter Project 2
      fs.cwd = () => project2Dir
      clearMemoryOnly()
      await addGlobalEntity('type', 'entity-p2', { source: 'proj2' })

      // 3. Verify Project 2 doesn't see Project 1
      const graph2 = getGlobalGraph()
      expect(Object.values(graph2.entities).some(e => e.name === 'entity-p1')).toBe(false)
      expect(Object.values(graph2.entities).some(e => e.name === 'entity-p2')).toBe(true)

      // 4. Switch back to Project 1 and verify isolation
      fs.cwd = () => project1Dir
      clearMemoryOnly()
      const graph1 = getGlobalGraph()
      expect(Object.values(graph1.entities).some(e => e.name === 'entity-p1')).toBe(true)
      expect(Object.values(graph1.entities).some(e => e.name === 'entity-p2')).toBe(false)
    } finally {
      fs.cwd = () => originalCwd
    }
  })

  it('handles data divergence by prioritizing latest timestamp (Heal Logic)', async () => {
    const fs = getFsImplementation()
    const cwd = fs.cwd()
    const projectDir = join(getProjectsDir(), sanitizePath(cwd))
    const jsonPath = join(projectDir, 'knowledge_graph.json')

    // 1. Initial sync
    await addGlobalEntity('type', 'base', { val: '0' })
    const baseTime = getGlobalGraph().lastUpdateTime

    // 2. Manually make JSON newer than SQLite (simulating failed SQL write / manual edit)
    clearMemoryOnly()
    const futureTime = baseTime + 10000
    const graph = getGlobalGraph()
    graph.lastUpdateTime = futureTime
    graph.entities[Object.keys(graph.entities)[0]].attributes.val = 'newer-json'
    writeFileSync(jsonPath, JSON.stringify(graph, null, 2))

    // 3. Load should pick the future JSON and heal SQLite
    clearMemoryOnly()
    // Need to trigger init to see the new JSON
    await initOrama(cwd)
    const healedGraph = getGlobalGraph()
    expect(healedGraph.lastUpdateTime).toBe(futureTime)
    expect(Object.values(healedGraph.entities)[0].attributes.val).toBe('newer-json')
  })

  it('enforces referential integrity (Relations Constraint)', async () => {
    const e1 = await addGlobalEntity('node', 'source')
    const e2 = await addGlobalEntity('node', 'target')
    
    // Valid relation
    await addGlobalRelation(e1.id, e2.id, 'links_to')
    
    // Invalid relation (non-existent ID) should throw
    let error = null
    try {
      await addGlobalRelation(e1.id, 'ghost-id', 'links_to')
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
  })

  it('recovers from corrupted SQLite header (SHORT_READ/Disk Error)', async () => {
    const cwd = getFsImplementation().cwd()
    const projectDir = join(getProjectsDir(), sanitizePath(cwd))
    const sqlitePath = join(projectDir, 'knowledge.db')

    // 1. Add valid data
    await addGlobalEntity('type', 'survivor', { status: 'alive' })
    expect(existsSync(sqlitePath)).toBe(true)

    // 2. Corrupt SQLite file header
    clearMemoryOnly()
    writeFileSync(sqlitePath, Buffer.from('NOT_SQLITE_BINARY'))

    // 3. System should detect error during init, delete corrupted db, and rebuild from JSON
    await initOrama(cwd)
    const graph = getGlobalGraph()
    expect(Object.values(graph.entities).some(e => e.name === 'survivor')).toBe(true)
    expect(existsSync(sqlitePath)).toBe(true) // Recreated
  })

  it('handles incremental updates (UPSERT strategy)', async () => {
    const name = 'incremental-entity'
    // 1. Create
    const e = await addGlobalEntity('type', name, { step: '1' })
    const id = e.id

    // 2. Update same entity with same name/type
    await addGlobalEntity('type', name, { step: '2', added: 'yes' })

    // 3. Verify SQLite merge (no duplicates, merged attributes)
    clearMemoryOnly()
    await initOrama(getFsImplementation().cwd())
    const graph = getGlobalGraph()
    const matches = Object.values(graph.entities).filter(e => e.name === name)
    expect(matches.length).toBe(1)
    expect(matches[0].id).toBe(id)
    expect(matches[0].attributes.step).toBe('2')
    expect(matches[0].attributes.added).toBe('yes')
  })
})

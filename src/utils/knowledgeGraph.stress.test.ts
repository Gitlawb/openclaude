import { describe, expect, it, beforeEach, afterEach, afterAll } from 'bun:test'
import {
  addGlobalEntity,
  addGlobalSummary,
  searchGlobalGraph,
  resetGlobalGraph,
  initOrama,
  getGlobalGraph,
  clearMemoryOnly
} from './knowledgeGraph.js'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFsImplementation } from './fsOperations.js'

describe('KnowledgeGraph Phase 1 Stress & Edge Cases', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const originalOrama = process.env.OPENCLAUDE_KNOWLEDGE_ORAMA
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-stress-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  const cwd = getFsImplementation().cwd()

  beforeEach(() => {
    process.env.OPENCLAUDE_KNOWLEDGE_ORAMA = '1'
    resetGlobalGraph()
  })

  afterAll(() => {
    resetGlobalGraph()
    clearMemoryOnly()
    
    // Restore config dir
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    
    // Restore Orama flag
    if (originalOrama === undefined) {
      delete process.env.OPENCLAUDE_KNOWLEDGE_ORAMA
    } else {
      process.env.OPENCLAUDE_KNOWLEDGE_ORAMA = originalOrama
    }
    
    rmSync(configDir, { recursive: true, force: true })
  })

  it('handles high-volume entity insertion (Stress Test)', async () => {
    const count = 50
    const start = Date.now()
    
    // Use sequential insertion to avoid Orama race conditions on disk/ID collisions
    for (let i = 0; i < count; i++) {
      await addGlobalEntity('stress_test', `entity_${i}`, { index: String(i), category: 'test' })
    }
    
    const duration = Date.now() - start
    console.log(`Inserted ${count} entities into Orama in ${duration}ms`)
    
    const graph = getGlobalGraph()
    expect(Object.keys(graph.entities).length).toBe(count)

    // Verify search still works under load
    const searchResult = await searchGlobalGraph('entity_25')
    expect(searchResult).toContain('entity_25')
  })

  it('handles complex queries and ranking', async () => {
    await addGlobalSummary('The authentication system uses JWT and OAuth2.', ['auth', 'security'])
    await addGlobalSummary('The security policy forbids cleartext passwords.', ['security', 'policy'])
    await addGlobalSummary('Frontend uses React and Tailwind.', ['ui', 'frontend'])

    // Search for "security" should return both relevant summaries
    const result = await searchGlobalGraph('security')
    expect(result).toContain('authentication')
    expect(result).toContain('cleartext')
    expect(result).not.toContain('React')
  })

  it('recovers from corrupted Orama file (Edge Case)', async () => {
    // 1. Create a valid DB
    await addGlobalEntity('type', 'valid', { val: '1' })
    const { getOramaPersistencePath } = await import('./knowledgeGraph.js')
    const oramaPath = getOramaPersistencePath(cwd)
    expect(existsSync(oramaPath)).toBe(true)

    // 2. Corrupt the file manually
    const { writeFileSync } = await import('fs')
    writeFileSync(oramaPath, Buffer.from('NOT_A_VALID_ORAMA_BINARY_FILE'))

    // 3. Re-initialize (should trigger the rename and fresh start)
    clearMemoryOnly()
    await initOrama(cwd)

    // 4. Verify we can still work (Orama should have re-synced from the JSON fallback)
    const result = await searchGlobalGraph('valid')
    expect(result).toContain('valid')
    
    // 5. Verify the corrupted file was moved
    const { readdirSync } = await import('fs')
    const projectsBaseDir = join(configDir, 'projects')
    if (!existsSync(projectsBaseDir)) {
      console.log('Projects base dir not found, checking alternative path...')
    }
    // Search recursively for the corrupted file
    const findCorrupted = (dir: string): boolean => {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (findCorrupted(join(dir, entry.name))) return true
        } else if (entry.name.includes('.corrupted.')) {
          return true
        }
      }
      return false
    }
    expect(findCorrupted(projectsBaseDir)).toBe(true)
  })

  it('maintains consistency between JSON and Orama', async () => {
    await addGlobalEntity('sync_test', 'entity_1', { status: 'initial' })
    
    // Force reload from disk
    clearMemoryOnly()
    
    // Update the same entity
    await addGlobalEntity('sync_test', 'entity_1', { status: 'updated' })
    
    const result = await searchGlobalGraph('entity_1')
    expect(result).toContain('updated')
    expect(result).not.toContain('initial')
    
    const graph = getGlobalGraph()
    const entities = Object.values(graph.entities).filter(e => e.name === 'entity_1')
    expect(entities.length).toBe(1)
    expect(entities[0].attributes.status).toBe('updated')
  })

  it('handles concurrent updates to the same entity (Orama Race Condition)', async () => {
    // 1. Create initial entity
    await addGlobalEntity('tool', 'concurrent-entity', { base: '1' })
    
    // 2. Perform 50 concurrent updates
    const count = 50
    const promises = []
    for (let i = 0; i < count; i++) {
      promises.push(addGlobalEntity('tool', 'concurrent-entity', { [`k${i}`]: String(i) }))
    }
    
    // This should NOT throw DOCUMENT_ALREADY_EXISTS now
    await Promise.all(promises)
    
    // 3. Verify final state in Orama
    const result = await searchGlobalGraph('concurrent-entity')
    // Should find the entity
    expect(result).toContain('concurrent-entity')
    
    // 4. Verify all attributes are merged in JSON
    const graph = getGlobalGraph()
    const entity = Object.values(graph.entities).find(e => e.name === 'concurrent-entity')
    expect(entity).toBeDefined()
    expect(entity?.attributes.base).toBe('1')
    for (let i = 0; i < count; i++) {
      expect(entity?.attributes[`k${i}`]).toBe(String(i))
    }
  })
})

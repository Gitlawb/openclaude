import { describe, expect, it, beforeEach, afterEach, afterAll, mock } from 'bun:test'

// Force enable Knowledge system for these tests ONLY
process.env.OPENCLAUDE_TEST_KNOWLEDGE = 'true'

import {
  addGlobalEntity,
  addGlobalSummary,
  resetGlobalGraph,
  clearMemoryOnly,
  getGlobalGraphSummary,
  addGlobalRule,
  getOrchestratedMemory
} from './knowledgeGraph.js'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Mock generateEmbedding to avoid network calls and speed up tests
mock.module('./embeddings.js', () => ({
  generateEmbedding: async () => [0.1, 0.2, 0.3], // Mocked small vector
}))

describe('KnowledgeGraph Technical Perfection', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-knowledge-perfection-'))
  process.env.CLAUDE_CONFIG_DIR = configDir

  beforeEach(async () => {
    await resetGlobalGraph()
  })

  afterAll(async () => {
    clearMemoryOnly()
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    rmSync(configDir, { recursive: true, force: true })
    delete process.env.OPENCLAUDE_TEST_KNOWLEDGE
  })

  it('handles project switching without cross-pollution', async () => {
    const project1 = join(configDir, 'p1')
    const project2 = join(configDir, 'p2')
    
    // We use process.chdir to simulate real project switching for our process.cwd() calls
    const originalCwd = process.cwd()
    try {
        mkdirSync(project1, { recursive: true })
        mkdirSync(project2, { recursive: true })
        
        process.chdir(project1)
        await addGlobalEntity('service', 'auth-v1', { port: '8080' })
        
        process.chdir(project2)
        await addGlobalEntity('service', 'payment-v2', { port: '9090' })

        const summary2 = await getGlobalGraphSummary()
        expect(summary2).toContain('payment-v2')
        expect(summary2).not.toContain('auth-v1')

        process.chdir(project1)
        const summary1 = await getGlobalGraphSummary()
        expect(summary1).toContain('auth-v1')
        expect(summary1).not.toContain('payment-v2')
    } finally {
        process.chdir(originalCwd)
    }
  })

  it('resolves concurrent additions through initialization lock', async () => {
    await Promise.all([
      addGlobalEntity('type', 'name1'),
      addGlobalEntity('type', 'name2'),
      addGlobalEntity('type', 'name3'),
    ])

    const summary = await getGlobalGraphSummary()
    expect(summary).toContain('name1')
    expect(summary).toContain('name2')
    expect(summary).toContain('name3')
  })

  it('performs hybrid RAG with balanced scoring and deduplication', async () => {
    await addGlobalEntity('concept', 'DatabaseMigration', { tool: 'Flyway' })
    await addGlobalSummary('The DatabaseMigration was performed using Flyway.', ['database', 'migration'])

    const result = await getOrchestratedMemory('tell me about database migration')
    expect(result).toContain('DatabaseMigration')
    
    const matches = result.match(/Flyway/g) || []
    expect(matches.length).toBeLessThanOrEqual(2)
  })

  it('strictly respects token budgeting with large payloads', async () => {
    for (let i = 0; i < 50; i++) {
      await addGlobalSummary(`Architecture fact #${i}: this is a detailed description to consume tokens.`, ['fact'])
    }

    const tokenLimit = 150
    const result = await getOrchestratedMemory('show me facts', tokenLimit)
    const wordCount = result.split(/\s+/).length
    expect(wordCount).toBeLessThan(tokenLimit + 50) 
  })
})

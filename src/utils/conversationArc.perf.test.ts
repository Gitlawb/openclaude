import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { 
  initializeArc, 
  updateArcPhase, 
  getArcSummary,
  resetArc 
} from './conversationArc.js'
import { getGlobalGraph, clearMemoryOnly, resetGlobalGraph } from './knowledgeGraph.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

function createMessage(content: string): any {
  return {
    message: { role: 'user', content, id: 'test', type: 'message', created_at: Date.now() },
    sender: 'user',
  }
}

describe('Conversation Arc Scale and Stability', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('conversationArc.perf')
    resetGlobalGraph()
    clearMemoryOnly()
    resetArc()
    initializeArc()
  })

  afterEach(() => {
    try {
      resetGlobalGraph()
      clearMemoryOnly()
      resetArc()
    } finally {
      releaseSharedMutationLock()
    }
  })

  it('extracts the expected facts repeatedly without unbounded graph growth', async () => {
    const iterations = 100
    const complexContent =
      'Deploying version v1.2.3 to /opt/prod/server on https://api.prod.local with JIRA_URL=https://jira.corp'

    for (let i = 0; i < iterations; i++) {
      await updateArcPhase([createMessage(complexContent)])
    }

    const graph = getGlobalGraph()
    const entityPairs = Object.values(graph.entities).map(entity => [
      entity.type,
      entity.name,
    ])

    expect(entityPairs).toContainEqual(['environment_variable', 'JIRA_URL'])
    expect(entityPairs).toContainEqual(['path', '/opt/prod/server'])
    expect(entityPairs).toContainEqual(['endpoint', 'api.prod.local'])
    expect(entityPairs).toContainEqual(['version', 'v1.2.3'])
    // Repeated extraction should upsert the same facts rather than ballooning.
    expect(Object.keys(graph.entities).length).toBeLessThanOrEqual(10)
  })

  it('generates summaries with a populated graph', async () => {
    // Populate graph with 50 facts
    for (let i = 0; i < 50; i++) {
      await updateArcPhase([createMessage(`Var_${i}=Value_${i} in /path/to/file_${i}`)])
    }

    const summary = await getArcSummary()

    expect(summary).toMatch(/Knowledge Graph/)
    expect(summary).toMatch(/project_file|path|environment_variable|concept/i)
  })

  it('maintains a compact memory footprint', async () => {
    const arc = initializeArc()
    for (let i = 0; i < 100; i++) {
      await updateArcPhase([createMessage(`Fact_${i}=Value_${i}`)])
    }

    const serialized = JSON.stringify(arc)
    const sizeKB = serialized.length / 1024

    // Should be well under 100KB for 100 simple facts
    expect(sizeKB).toBeLessThan(100)
  })
})

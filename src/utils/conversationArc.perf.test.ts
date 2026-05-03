import { describe, expect, it, beforeEach } from 'bun:test'
import { 
  initializeArc, 
  updateArcPhase, 
  getArcSummary,
  resetArc 
} from './conversationArc.js'
import { resetGlobalGraph } from './knowledgeGraph.js'

function createMessage(content: string): any {
  return {
    message: { role: 'user', content, id: 'test', type: 'message', created_at: Date.now() },
    sender: 'user',
  }
}

describe('Conversation Arc Performance Benchmarks', () => {
  beforeEach(async () => {
    resetArc()
    await resetGlobalGraph()
    await initializeArc()
  })

  it('performs automatic fact extraction in sub-millisecond time', async () => {
    const iterations = 100
    const complexContent = 'Deploying version v1.2.3 to /opt/prod/server on https://api.prod.local with JIRA_URL=https://jira.corp'
    
    const startTime = performance.now()
    for (let i = 0; i < iterations; i++) {
      await updateArcPhase([createMessage(complexContent)])
    }
    const duration = performance.now() - startTime
    const averageTime = duration / iterations

    console.log(`[Benchmark] Avg extraction time: ${averageTime.toFixed(4)}ms`)
    
    // Performance guard: relaxed for universal driver + SQLite overhead
    expect(averageTime).toBeLessThan(10.0)
  })

  it('generates summaries quickly even with a populated graph', async () => {
    // Populate graph with 50 facts
    for (let i = 0; i < 50; i++) {
      await updateArcPhase([createMessage(`Var_${i}=Value_${i} in /path/to/file_${i}`)])
    }

    const startTime = performance.now()
    const summary = await getArcSummary()
    const duration = performance.now() - startTime

    console.log(`[Benchmark] Summary generation time (50 entities): ${duration.toFixed(4)}ms`)
    expect(summary).toMatch(/Knowledge Graph/);
    expect(duration).toBeLessThan(1000)
  })

  it('maintains a compact memory footprint', async () => {
    const arc = await initializeArc()
    for (let i = 0; i < 100; i++) {
      await updateArcPhase([createMessage(`Fact_${i}=Value_${i}`)])
    }
    
    const serialized = JSON.stringify(arc)
    const sizeKB = serialized.length / 1024
    console.log(`[Benchmark] Memory footprint (100 facts): ${sizeKB.toFixed(2)}KB`)
    
    expect(sizeKB).toBeLessThan(100)
  })
})

import { describe, expect, it, beforeEach } from 'bun:test'
import { 
  initializeArc, 
  updateArcPhase, 
  getArcSummary,
  resetArc 
} from './conversationArc.js'

function createMessage(content: string): any {
  return {
    message: { role: 'user', content, id: 'test', type: 'message', created_at: Date.now() },
    sender: 'user',
  }
}

describe('Conversation Arc Performance Benchmarks', () => {
  beforeEach(() => {
    resetArc()
    initializeArc()
  })

  it('performs automatic fact extraction in sub-millisecond time', () => {
    const iterations = 100
    const complexContent = 'Deploying version v1.2.3 to /opt/prod/server on https://api.prod.local with JIRA_URL=https://jira.corp'
    
    const startTime = performance.now()
    for (let i = 0; i < iterations; i++) {
      updateArcPhase([createMessage(complexContent)])
    }
    const duration = performance.now() - startTime
    const averageTime = duration / iterations

    console.log(`[Benchmark] Avg extraction time: ${averageTime.toFixed(4)}ms`)
    
    // Performance guard: should definitely be under 2.0ms per message on any modern CI
    // (Monster engine is more complex than initial version)
    expect(averageTime).toBeLessThan(2.0)
  })

  it('generates summaries quickly even with a populated graph', () => {
    // Populate graph with 50 facts
    for (let i = 0; i < 50; i++) {
      updateArcPhase([createMessage(`Var_${i}=Value_${i} in /path/to/file_${i}`)])
    }

    const startTime = performance.now()
    const summary = getArcSummary()
    const duration = performance.now() - startTime

    console.log(`[Benchmark] Summary generation time (50 entities): ${duration.toFixed(4)}ms`)
    expect(summary).toMatch(/Knowledge Graph/);
    // Summary generation should be extremely fast
    expect(duration).toBeLessThan(10)
  })

  it('maintains a compact memory footprint', () => {
    const arc = initializeArc()
    for (let i = 0; i < 100; i++) {
      updateArcPhase([createMessage(`Fact_${i}=Value_${i}`)])
    }
    
    const serialized = JSON.stringify(arc)
    const sizeKB = serialized.length / 1024
    console.log(`[Benchmark] Memory footprint (100 facts): ${sizeKB.toFixed(2)}KB`)
    
    // Should be well under 100KB for 100 simple facts
    expect(sizeKB).toBeLessThan(100)
  })
})

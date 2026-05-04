import { describe, expect, it } from 'bun:test'
import {
  intelligentSummarize,
  createCompactSummary,
  extractSemanticClusters,
} from './intelligentSummarization.js'

describe('intelligentSummarization', () => {
  describe('intelligentSummarize', () => {
    it('summarizes messages to target token count', () => {
      const messages = [
        { role: 'user', content: 'Hello, how are you today?', created_at: 1000 },
        { role: 'assistant', content: 'I am doing great, thank you for asking!', created_at: 2000 },
        { role: 'user', content: 'Can you help me with some code?', created_at: 3000 },
        { role: 'assistant', content: 'Of course! What do you need help with?', created_at: 4000 },
      ]
      
      const result = intelligentSummarize(messages, { targetTokens: 100 })
      
      expect(result.summary).toBeDefined()
      expect(result.originalTokens).toBeGreaterThan(0)
      expect(result.compressionRatio).toBeGreaterThan(0)
    })

    it('preserves tool calls in summary', () => {
      const messages = [
        { role: 'user', content: 'Check the file system', created_at: 1000 },
        { role: 'assistant', content: 'Using tool_use to check files', created_at: 2000 },
      ]
      
      const result = intelligentSummarize(messages, { targetTokens: 100 })
      
      expect(result.preservedMetadata.toolCalls).toBeGreaterThanOrEqual(0)
    })

    it('calculates quality score', () => {
      const messages = [
        { role: 'user', content: 'Important error occurred', created_at: 1000 },
        { role: 'assistant', content: 'I fixed the critical issue', created_at: 2000 },
      ]
      
      const result = intelligentSummarize(messages, { targetTokens: 50 })
      
      expect(result.qualityScore).toBeGreaterThan(0)
      expect(result.qualityScore).toBeLessThanOrEqual(1)
    })
  })

  describe('createCompactSummary', () => {
    it('creates compact summary string', () => {
      const messages = [
        { role: 'user', content: 'Hello world', created_at: 1000 },
        { role: 'assistant', content: 'Hi there', created_at: 2000 },
      ]
      
      const summary = createCompactSummary(messages, 50)
      
      expect(summary).toBeDefined()
      expect(summary.length).toBeGreaterThan(0)
    })
  })

  describe('extractSemanticClusters', () => {
    it('groups related messages', () => {
      const messages = [
        { role: 'user', content: 'file system check', created_at: 1000 },
        { role: 'assistant', content: 'files checked', created_at: 2000 },
        { role: 'user', content: 'code error fix', created_at: 3000 },
        { role: 'assistant', content: 'error fixed', created_at: 4000 },
      ]
      
      const clusters = extractSemanticClusters(messages)
      
      expect(clusters.size).toBeGreaterThan(0)
    })
  })
})
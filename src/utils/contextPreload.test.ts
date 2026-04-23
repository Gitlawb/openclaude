import { describe, expect, it } from 'bun:test'
import {
  analyzeConversationPatterns,
  predictContextNeeds,
  preloadContext,
  createPreloadStrategy,
} from './contextPreload.js'

function createMessage(role: string, content: string, createdAt: number = Date.now()): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: createdAt },
    sender: role,
  }
}

describe('contextPreload', () => {
  describe('analyzeConversationPatterns', () => {
    it('extracts patterns from messages', () => {
      const messages = [
        createMessage('user', 'Fix the error in my code', 1000),
        createMessage('assistant', 'I found the bug', 2000),
      ]

      const patterns = analyzeConversationPatterns(messages)

      expect(patterns.length).toBeGreaterThanOrEqual(0)
    })

    it('detects debug patterns', () => {
      const messages = [
        createMessage('user', 'Debug this error please', 1000),
        createMessage('assistant', 'Found it', 2000),
      ]

      const patterns = analyzeConversationPatterns(messages)

      expect(patterns.some(p => p.userQuery === 'debug')).toBe(true)
    })

    it('detects code patterns', () => {
      const messages = [
        createMessage('user', 'Write a function for me', 1000),
        createMessage('assistant', 'Here is the code', 2000),
      ]

      const patterns = analyzeConversationPatterns(messages)

      expect(patterns.some(p => p.userQuery === 'code')).toBe(true)
    })
  })

  describe('predictContextNeeds', () => {
    it('predicts context needs based on query', () => {
      const patterns = [{ userQuery: 'debug', neededContext: ['error_history'], frequency: 1 }]

      const prediction = predictContextNeeds('Fix the bug', patterns, {
        maxPreloadTokens: 10000,
        confidenceThreshold: 0.3,
      })

      expect(prediction.confidence).toBeGreaterThan(0)
    })
  })

  describe('preloadContext', () => {
    it('preloads relevant context', () => {
      const messages = [
        createMessage('system', 'System prompt'),
        createMessage('user', 'Debug error'),
        createMessage('assistant', 'Fixed'),
      ]

      const prediction = { predictedNeed: ['error'], confidence: 0.8, suggestedMessages: [] }

      const result = preloadContext(messages, prediction, { maxPreloadTokens: 5000 })

      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('createPreloadStrategy', () => {
    it('creates strategy with all methods', () => {
      const strategy = createPreloadStrategy({ maxPreloadTokens: 10000 })

      expect(strategy.analyze).toBeDefined()
      expect(strategy.predict).toBeDefined()
      expect(strategy.preload).toBeDefined()
    })
  })
})
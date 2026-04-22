import { describe, expect, it } from 'bun:test'
import {
  calculateImportanceScores,
  selectWeightedMessages,
  getWeightedStats,
  getTopMessagesByWeight,
} from './importanceWeightedContext.js'

function createMessage(role: string, content: string, createdAt: number = Date.now()): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: createdAt },
    sender: role,
  }
}

describe('importanceWeightedContext', () => {
  describe('calculateImportanceScores', () => {
    it('calculates importance scores', () => {
      const messages = [
        createMessage('user', 'Hello there'),
        createMessage('assistant', 'Hi back'),
      ]

      const scores = calculateImportanceScores(messages, { maxTokens: 10000 })

      expect(scores.length).toBe(2)
      expect(scores[0].score).toBeGreaterThan(0)
      expect(scores[0].factors).toBeDefined()
    })

    it('scores recent messages higher', () => {
      const oldMsg = createMessage('user', 'Hello there', Date.now() - 86400000)
      const recentMsg = createMessage('user', 'Recent message', Date.now())

      const scores = calculateImportanceScores([oldMsg, recentMsg], { maxTokens: 10000 })

      const oldScore = scores.find(s => s.message.message?.created_at === oldMsg.message.created_at)?.score ?? 0
      const recentScore = scores.find(s => s.message.message?.created_at === recentMsg.message.created_at)?.score ?? 0

      expect(recentScore).toBeGreaterThanOrEqual(oldScore)
    })

    it('scores user messages', () => {
      const assistantMsg = createMessage('assistant', 'Assistant response')
      const userMsg = createMessage('user', 'User message')

      const scores = calculateImportanceScores([assistantMsg, userMsg], { maxTokens: 10000 })

      const assistantScore = scores.find(s => s.message.message?.role === 'assistant')?.score ?? 0
      const userScore = scores.find(s => s.message.message?.role === 'user')?.score ?? 0

      expect(userScore).toBeGreaterThanOrEqual(assistantScore)
    })
  })

  describe('selectWeightedMessages', () => {
    it('selects messages within token limit', () => {
      const messages = [
        createMessage('user', 'Message 1'),
        createMessage('assistant', 'Message 2'),
        createMessage('user', 'Message 3'),
      ]

      const selected = selectWeightedMessages(messages, { maxTokens: 50 })

      expect(selected.length).toBeLessThanOrEqual(messages.length)
    })
  })

  describe('getWeightedStats', () => {
    it('returns statistics', () => {
      const messages = [
        createMessage('user', 'User message'),
        createMessage('assistant', 'Assistant response'),
      ]

      const stats = getWeightedStats(messages, { maxTokens: 10000 })

      expect(stats.averageScore).toBeGreaterThan(0)
      expect(stats.totalTokens).toBeGreaterThan(0)
    })
  })

  describe('getTopMessagesByWeight', () => {
    it('returns top N messages', () => {
      const messages = [
        createMessage('user', 'Message about python', 1000),
        createMessage('assistant', 'Python is great', 2000),
        createMessage('user', 'Message about javascript', 3000),
      ]

      const top = getTopMessagesByWeight(messages, { maxTokens: 10000 }, 2)

      expect(top.length).toBeLessThanOrEqual(2)
    })
  })
})
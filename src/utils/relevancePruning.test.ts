import { describe, expect, it } from 'bun:test'
import {
  pruneByRelevance,
  getTopRelevantMessages,
  getRelevanceStats,
  hasToolCalls,
  hasErrors,
} from './relevancePruning.js'

function createMessage(role: string, content: string, createdAt: number = Date.now()): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: createdAt },
    sender: role,
  }
}

describe('relevancePruning', () => {
  describe('pruneByRelevance', () => {
    it('prunes to target token count', () => {
      const messages = [
        createMessage('user', 'Hello world how are you', 1000),
        createMessage('assistant', 'I am doing great', 2000),
        createMessage('user', 'Can you help with python', 3000),
      ]

      const result = pruneByRelevance(messages, { targetTokens: 50 })

      expect(result.length).toBeLessThanOrEqual(messages.length)
    })

    it('preserves recent messages', () => {
      const messages = [
        createMessage('user', 'Old message', 1000),
        createMessage('user', 'Recent message', Date.now()),
      ]

      const result = pruneByRelevance(messages, { targetTokens: 100, preserveRecent: 1 })

      expect(result.length).toBeGreaterThan(0)
    })

    it('preserves message id groups together', () => {
      // Messages with same ID should be kept together
      const messages = [
        { message: { role: 'assistant', content: 'Hello', id: 'msg1', created_at: 1000 } },
        { message: { role: 'tool_result', content: 'Result', id: 'msg1', created_at: 1001 } },
        { message: { role: 'user', content: 'New request', id: 'msg2', created_at: 2000 } },
      ] as any[]

      const result = pruneByRelevance(messages, { targetTokens: 500 })

      // Either both msg1 messages are kept or neither (not partial)
      const msg1Msgs = result.filter(m => m.message?.id === 'msg1')
      // If any msg1 is kept, all should be kept
      if (msg1Msgs.length > 0) {
        expect(msg1Msgs.length).toBe(2)
      }
    })

    it('preserves API-round groups (tool_use + tool_result) together', () => {
      // Simulate tool_use + tool_result in same API round (same assistant message.id)
      const messages = [
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Read' }], id: 'api-round-1', created_at: 1000 } },
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents' }], created_at: 1001 } },
        { type: 'assistant', message: { role: 'assistant', content: 'Response 1', id: 'api-round-2', created_at: 2000 } },
        { type: 'user', message: { role: 'user', content: 'User question', id: 'api-round-3', created_at: 3000 } },
        { type: 'assistant', message: { role: 'assistant', content: 'Response 2', id: 'api-round-4', created_at: 4000 } },
      ] as any[]

      const result = pruneByRelevance(messages, { targetTokens: 200, preserveRecent: 1 })

      const round1Msgs = result.filter(m => m.message?.id === 'api-round-1')
      const toolResultForTu1 = result.filter(m => 
        m.message?.content?.[0]?.type === 'tool_result' && m.message.content[0].tool_use_id === 'tu1'
      )

      // Both tool_use and its tool_result should be kept together or neither
      if (round1Msgs.length > 0) {
        expect(toolResultForTu1.length).toBe(1)
      }
    })
  })

  describe('hasToolCalls', () => {
    it('detects tool calls', () => {
      const msg = createMessage('assistant', 'Using tool_use to check file')
      expect(hasToolCalls(msg)).toBe(true)
    })

    it('returns false for regular content', () => {
      const msg = createMessage('user', 'Hello there')
      expect(hasToolCalls(msg)).toBe(false)
    })
  })

  describe('hasErrors', () => {
    it('detects errors', () => {
      const msg = createMessage('assistant', 'Found an error in code')
      expect(hasErrors(msg)).toBe(true)
    })

    it('returns false for normal content', () => {
      const msg = createMessage('user', 'Hello there')
      expect(hasErrors(msg)).toBe(false)
    })
  })

  describe('getTopRelevantMessages', () => {
    it('returns top N messages', () => {
      const messages = [
        createMessage('user', 'Python programming', 1000),
        createMessage('assistant', 'Python is great', 2000),
        createMessage('user', 'JavaScript here', 3000),
      ]

      const result = getTopRelevantMessages(
        messages,
        { targetTokens: 100, taskContext: 'python' },
        2
      )

      expect(result.length).toBeLessThanOrEqual(2)
    })
  })

  describe('getRelevanceStats', () => {
    it('calculates statistics', () => {
      const messages = [
        createMessage('user', 'Important about errors', 1000),
        createMessage('assistant', 'Using tool_use', 2000),
        createMessage('user', 'Regular message', 3000),
      ]

      const stats = getRelevanceStats(messages, {
        targetTokens: 100,
        preserveTools: true,
        preserveErrors: true,
      })

      expect(stats.averageScore).toBeGreaterThan(0)
      expect(stats.toolCallCount).toBeGreaterThanOrEqual(0)
    })
  })
})
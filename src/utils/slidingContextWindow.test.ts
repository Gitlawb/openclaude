import { describe, expect, it } from 'bun:test'
import {
  createSlidingWindow,
  slideWindow,
  getWindowStats,
  canAddToWindow,
} from './slidingContextWindow.js'

function createMessage(role: string, content: string, createdAt: number = Date.now()): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: createdAt },
    sender: role,
  }
}

describe('slidingContextWindow', () => {
  describe('createSlidingWindow', () => {
    it('enforces maxTokens limit', () => {
      const messages = [
        createMessage('user', 'A'.repeat(1000), 1000),
        createMessage('user', 'B'.repeat(1000), 2000),
        createMessage('user', 'C'.repeat(1000), 3000),
        createMessage('user', 'Recent', Date.now()),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 100, preserveRecent: 1 })

      expect(state.totalTokens).toBeLessThanOrEqual(1000)
    })

    it('never drops preserved recent messages', () => {
      const messages = [
        createMessage('user', 'Old', 1000),
        createMessage('user', 'Old2', 2000),
        createMessage('user', 'Recent1', Date.now()),
        createMessage('user', 'Recent2', Date.now()),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 100, preserveRecent: 2 })
      const recentCount = state.messages.filter(m => 
        (m.message?.created_at ?? 0) >= Date.now() - 1000
      ).length

      expect(recentCount).toBeGreaterThanOrEqual(2)
    })

    it('handles structured content blocks', () => {
      const messages = [{
        message: { 
          role: 'assistant', 
          content: [
            { type: 'tool_use', id: 'tool1', name: 'read' },
            { type: 'text', text: 'result here' }
          ], 
          id: 'test', 
          type: 'message', 
          created_at: Date.now() 
        },
        sender: 'assistant',
      }]

      const state = createSlidingWindow(messages, { maxTokens: 10000, preserveTools: true })

      expect(state.messages.length).toBe(1)
      expect(state.totalTokens).toBeGreaterThan(0)
    })
  })

  describe('slideWindow', () => {
    it('adds new messages to window', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi there'),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 10000 })
      const newState = slideWindow(state, [createMessage('user', 'New message', Date.now())], { maxTokens: 10000 })

      expect(newState.messages.length).toBeGreaterThanOrEqual(state.messages.length)
    })
  })

  describe('getWindowStats', () => {
    it('returns window statistics', () => {
      const messages = [
        createMessage('user', 'Test message'),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 10000 })
      const stats = getWindowStats(state)

      expect(stats.totalTokens).toBeGreaterThan(0)
      expect(stats.messageCount).toBeGreaterThan(0)
      expect(stats.windowAgeMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('canAddToWindow', () => {
    it('returns true when under limit', () => {
      const messages = [createMessage('user', 'Short')]
      const state = createSlidingWindow(messages, { maxTokens: 10000 })
      const newMsg = createMessage('user', 'Another short message')

      const canAdd = canAddToWindow(state, newMsg, { maxTokens: 10000 })

      expect(canAdd).toBe(true)
    })
  })
})
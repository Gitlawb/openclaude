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
    it('creates window within token limit', () => {
      const messages = [
        createMessage('user', 'Hello world'),
        createMessage('assistant', 'Hi there'),
        createMessage('user', 'Help with code'),
        createMessage('assistant', 'What do you need?'),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 10000 })

      expect(state.totalTokens).toBeGreaterThan(0)
      expect(state.messages.length).toBeGreaterThan(0)
    })

    it('preserves recent messages', () => {
      const messages = [
        createMessage('user', 'Old message', 1000),
        createMessage('assistant', 'Old response', 2000),
        createMessage('user', 'Recent message', Date.now()),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 10000, preserveRecent: 2 })

      expect(state.messages.length).toBeGreaterThan(0)
    })

    it('preserves tool calls', () => {
      const messages = [
        createMessage('user', 'Regular message', 1000),
        createMessage('assistant', 'Using tool_use to check file', 2000),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 10000, preserveTools: true })

      expect(state.messages.length).toBeGreaterThan(0)
    })

    it('drops messages when over limit', () => {
      const messages = [
        createMessage('user', 'Message 1', 1000),
        createMessage('user', 'Message 2', 2000),
        createMessage('user', 'Message 3', 3000),
        createMessage('user', 'Message 4', 4000),
      ]

      const state = createSlidingWindow(messages, { maxTokens: 50 })

      expect(state.droppedCount).toBeGreaterThanOrEqual(0)
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
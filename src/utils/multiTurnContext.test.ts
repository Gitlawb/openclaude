import { describe, expect, it, beforeEach } from 'bun:test'
import {
  startNewTurn,
  getCurrentTurn,
  addMessageToTurn,
  addToolCallToTurn,
  setTurnState,
  getTurnState,
  getTurnHistory,
  getRecentTurns,
  getMultiTurnStats,
  resetMultiTurnState,
  createMultiTurnTracker,
} from './multiTurnContext.js'

function createMessage(role: string, content: string): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: Date.now() },
    sender: role,
  }
}

describe('multiTurnContext', () => {
  beforeEach(() => {
    resetMultiTurnState()
  })

  describe('startNewTurn', () => {
    it('creates a new turn', () => {
      const turn = startNewTurn()
      expect(turn.turnId).toBeDefined()
      expect(turn.messages).toEqual([])
      expect(turn.toolCalls).toEqual([])
    })

    it('tracks turn count', () => {
      startNewTurn()
      const turn2 = startNewTurn()
      expect(turn2.turnId).toContain('turn_2')
    })
  })

  describe('addMessageToTurn', () => {
    it('adds message to current turn', () => {
      startNewTurn()
      addMessageToTurn(createMessage('user', 'Hello'))

      const turn = getCurrentTurn()
      expect(turn?.messages.length).toBe(1)
    })

    it('creates turn if none exists', () => {
      addMessageToTurn(createMessage('user', 'Hello'))
      expect(getCurrentTurn()).not.toBeNull()
    })
  })

  describe('addToolCallToTurn', () => {
    it('adds tool call to turn', () => {
      startNewTurn()
      addToolCallToTurn({ id: 'tool1', name: 'read', input: { file: 'test' }, timestamp: Date.now() })

      const turn = getCurrentTurn()
      expect(turn?.toolCalls.length).toBe(1)
      expect(turn?.toolCalls[0].name).toBe('read')
    })
  })

  describe('state management', () => {
    it('sets and gets turn state', () => {
      startNewTurn()
      setTurnState('key1', 'value1')
      expect(getTurnState<string>('key1')).toBe('value1')
    })

    it('returns undefined for unknown keys', () => {
      startNewTurn()
      expect(getTurnState('unknown')).toBeUndefined()
    })
  })

  describe('getTurnHistory', () => {
    it('returns turn history', () => {
      startNewTurn()
      startNewTurn()

      const history = getTurnHistory()
      expect(history.length).toBe(2)
    })
  })

  describe('getRecentTurns', () => {
    it('returns recent turns', () => {
      for (let i = 0; i < 5; i++) startNewTurn()

      const recent = getRecentTurns(3)
      expect(recent.length).toBe(3)
    })
  })

  describe('getMultiTurnStats', () => {
    it('returns statistics', () => {
      startNewTurn()
      addMessageToTurn(createMessage('user', 'Test'))

      const stats = getMultiTurnStats()
      expect(stats.totalTurns).toBe(1)
      expect(stats.currentTurnActive).toBe(true)
    })
  })

  describe('createMultiTurnTracker', () => {
    it('creates tracker with all methods', () => {
      const tracker = createMultiTurnTracker()
      expect(tracker.startTurn).toBeDefined()
      expect(tracker.addMessage).toBeDefined()
      expect(tracker.getStats).toBeDefined()
    })

    it('respects the maxTurns option', () => {
      // Create a tracker with a very small maxTurns
      createMultiTurnTracker({ maxTurns: 2 })

      startNewTurn() // turn 1
      startNewTurn() // turn 2
      startNewTurn() // turn 3 - should drop turn 1

      const history = getTurnHistory()
      expect(history.length).toBe(2)
      // The first remaining turn should be the 2nd one created
      expect(history[0].turnId).toContain('turn_2')
    })
    })
    })
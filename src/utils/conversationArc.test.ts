import { describe, expect, it, beforeEach } from 'bun:test'
import {
  initializeArc,
  getArc,
  updateArcPhase,
  addGoal,
  updateGoalStatus,
  addDecision,
  addMilestone,
  getArcSummary,
  resetArc,
  getArcStats,
} from './conversationArc.js'

function createMessage(role: string, content: string): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: Date.now() },
    sender: role,
  }
}

describe('conversationArc', () => {
  beforeEach(() => {
    resetArc()
  })

  describe('initializeArc', () => {
    it('creates new arc', () => {
      const arc = initializeArc()
      expect(arc.id).toBeDefined()
      expect(arc.currentPhase).toBe('init')
      expect(arc.goals).toEqual([])
      expect(arc.decisions).toEqual([])
    })
  })

  describe('getArc', () => {
    it('returns existing arc or creates new', () => {
      const arc1 = getArc()
      const arc2 = getArc()
      expect(arc1?.id).toBe(arc2?.id)
    })
  })

  describe('updateArcPhase', () => {
    it('detects exploring phase', () => {
      initializeArc()
      updateArcPhase([createMessage('user', 'Find the file')])

      expect(getArc()?.currentPhase).toBe('exploring')
    })

    it('detects implementing phase', () => {
      initializeArc()
      updateArcPhase([createMessage('user', 'Write the code')])

      expect(getArc()?.currentPhase).toBe('implementing')
    })

    it('progresses phases forward only', () => {
      initializeArc()
      updateArcPhase([createMessage('user', 'Write code')])
      updateArcPhase([createMessage('user', 'Find file')])

      // Phase should remain at implementing since it was detected first
      expect(getArc()?.currentPhase).toBe('implementing')
    })
  })

  describe('goal management', () => {
    it('adds goal', () => {
      initializeArc()
      const goal = addGoal('Fix the bug')
      expect(goal.description).toBe('Fix the bug')
      expect(goal.status).toBe('pending')
    })

    it('updates goal status', () => {
      initializeArc()
      const goal = addGoal('Test feature')
      updateGoalStatus(goal.id, 'completed')

      const updated = getArc()?.goals.find(g => g.id === goal.id)
      expect(updated?.status).toBe('completed')
      expect(updated?.completedAt).toBeDefined()
    })
  })

  describe('addDecision', () => {
    it('adds decision', () => {
      initializeArc()
      const decision = addDecision('Use TypeScript', 'Type safety')
      expect(decision.description).toBe('Use TypeScript')
      expect(decision.rationale).toBe('Type safety')
    })
  })

  describe('addMilestone', () => {
    it('adds milestone', () => {
      initializeArc()
      const milestone = addMilestone('Phase 1 complete')
      expect(milestone.description).toBe('Phase 1 complete')
      expect(milestone.achievedAt).toBeDefined()
    })
  })

  describe('getArcSummary', () => {
    it('returns summary string', () => {
      initializeArc()
      addGoal('Test goal')
      const summary = getArcSummary()

      expect(summary).toContain('Phase:')
      expect(summary).toContain('Goals:')
    })
  })

  describe('getArcStats', () => {
    it('returns statistics', () => {
      initializeArc()
      addGoal('Goal 1')
      addDecision('Decision 1')

      const stats = getArcStats()
      expect(stats?.goalCount).toBe(1)
      expect(stats?.decisionCount).toBe(1)
    })
  })
})
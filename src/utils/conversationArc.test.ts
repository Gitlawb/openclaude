import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import {
  initializeArc,
  getArc,
  updateArcPhase,
  addGoal,
  updateGoalStatus,
  addDecision,
  addMilestone,
  addEntity,
  addRelation,
  getGraphSummary,
  getArcSummary,
  resetArc,
  getArcStats,
  finalizeArcTurn,
} from './conversationArc.js'
import { getGlobalGraph, resetGlobalGraph } from './knowledgeGraph.js'

function createMessage(role: string, content: string): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: Date.now() },
    sender: role,
  }
}

describe('conversationArc', () => {
  beforeEach(() => {
    resetArc()
    resetGlobalGraph()
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

  describe('Knowledge Graph', () => {
    it('adds entities and relations', () => {
      initializeArc()
      const e1 = addEntity('system', 'RHEL9', { version: '9.4' })
      const e2 = addEntity('credential', 'Jira PAT')

      expect(e1.name).toBe('RHEL9')
      expect(e1.attributes.version).toBe('9.4')

      addRelation(e1.id, e2.id, 'requires')

      const graph = getGlobalGraph()
      expect(Object.keys(graph.entities).length).toBeGreaterThanOrEqual(2)
      expect(graph.relations.some(r => r.type === 'requires')).toBe(true)
    })

    it('generates a knowledge graph summary', () => {
      resetGlobalGraph()
      initializeArc()
      const e1 = addEntity('system', 'RHEL-TEST', { os: 'linux' })
      const e2 = addEntity('feature', 'OpenClaude-TEST')
      addRelation(e2.id, e1.id, 'runs_on')

      const summary = getArcSummary()
      expect(summary).toMatch(/Knowledge Graph/);
      expect(summary).toContain('[system] RHEL-TEST')
      expect(summary).toMatch(/os: linux/);
    })

    it('automatically learns facts from message content', () => {
      resetGlobalGraph()
      initializeArc()
      const complexMessage = createMessage('user', 'Set JIRA_URL_TEST=https://jira.local and look in /opt/app/bin/test version v1.2.3')

      updateArcPhase([complexMessage])

      const summary = getGraphSummary()
      expect(summary).toContain('JIRA_URL_TEST')
      expect(summary).toContain('jira.local')
      expect(summary).toContain('/opt/app/bin/test')
      expect(summary).toContain('v1.2.3')
    })

    it('throws error when adding relation to non-existent entity', () => {
      initializeArc()
      expect(() => addRelation('invalid1', 'invalid2', 'test')).toThrow('Source or target entity not found in graph')
    })
  })

  describe('finalizeArcTurn', () => {
    it('generates and persists a summary of the turn', () => {
      initializeArc()
      addGoal('Build RAG engine')
      updateGoalStatus(getArc()!.goals[0].id, 'completed')
      addDecision('Use JSON for storage')

      finalizeArcTurn()

      const summary = getGraphSummary()
      expect(summary).toMatch(/Knowledge Graph/);
      // searchGlobalGraph should now find it
      const ragResult = getArcSummary('Tell me about the RAG engine')
      expect(ragResult).toContain('Build RAG engine')
      expect(ragResult).toContain('Use JSON for storage')
    })
  })

  describe('resetArc', () => {
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

    it('detects phase from block array content', () => {
      initializeArc()
      const blockMessage = {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will now implement the requested changes.' }],
          id: 'test',
          type: 'message',
          created_at: Date.now(),
        },
        sender: 'assistant',
      }
      updateArcPhase([blockMessage as any])

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

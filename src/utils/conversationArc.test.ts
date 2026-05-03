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
  beforeEach(async () => {
    resetArc()
    await resetGlobalGraph()
  })

  describe('initializeArc', () => {
    it('creates new arc', async () => {
      const arc = await initializeArc()
      expect(arc.id).toBeDefined()
      expect(arc.currentPhase).toBe('init')
      expect(arc.goals).toEqual([])
      expect(arc.decisions).toEqual([])
    })
  })

  describe('Knowledge Graph', () => {
    it('adds entities and relations', async () => {
      await initializeArc()
      const e1 = await addEntity('system', 'RHEL9', { version: '9.4' })
      const e2 = await addEntity('credential', 'Jira PAT')

      expect(e1.name).toBe('RHEL9')
      expect(e1.attributes.version).toBe('9.4')

      await addRelation(e1.id, e2.id, 'requires')

      const graph = await getGlobalGraph()
      expect(Object.keys(graph.entities).length).toBeGreaterThanOrEqual(2)
      expect(graph.relations.some(r => r.type === 'requires')).toBe(true)
    })

    it('generates a knowledge graph summary', async () => {
      await resetGlobalGraph()
      await initializeArc()
      const e1 = await addEntity('system', 'RHEL-TEST', { os: 'linux' })
      const e2 = await addEntity('feature', 'OpenClaude-TEST')
      await addRelation(e2.id, e1.id, 'runs_on')

      const summary = await getArcSummary()
      expect(summary).toMatch(/Knowledge Graph/);
      expect(summary).toContain('[system] RHEL-TEST')
      expect(summary).toMatch(/os: linux/);
    })

    it('automatically learns facts from message content', async () => {
      await resetGlobalGraph()
      await initializeArc()
      const complexMessage = createMessage('user', 'Set JIRA_URL_TEST=https://jira.local and look in /opt/app/bin/test version v1.2.3')

      await updateArcPhase([complexMessage])

      const summary = await getGraphSummary()
      expect(summary).toContain('JIRA_URL_TEST')
      expect(summary).toContain('jira.local')
      expect(summary).toContain('/opt/app/bin/test')
      expect(summary).toContain('v1.2.3')
    })

    it('throws error when adding relation to non-existent entity', async () => {
      await initializeArc()
      await expect(addRelation('invalid1', 'invalid2', 'test')).rejects.toThrow('Source or target entity not found in graph')
    })
  })

  describe('finalizeArcTurn', () => {
    it('generates and persists a summary of the turn', async () => {
      await initializeArc()
      await addGoal('Build RAG engine')
      const arc = await getArc()
      await updateGoalStatus(arc!.goals[0].id, 'completed')
      await addDecision('Use JSON for storage')

      await finalizeArcTurn()

      const summary = await getGraphSummary()
      expect(summary).toMatch(/Knowledge Graph/);
      const ragResult = await getArcSummary('Tell me about the RAG engine')
      expect(ragResult).toContain('Build RAG engine')
      expect(ragResult).toContain('Use JSON for storage')
    })
  })

  describe('resetArc', () => {
    it('returns existing arc or creates new', async () => {
      const arc1 = await getArc()
      const arc2 = await getArc()
      expect(arc1?.id).toBe(arc2?.id)
    })
  })

  describe('updateArcPhase', () => {
    it('detects exploring phase', async () => {
      await initializeArc()
      await updateArcPhase([createMessage('user', 'Find the file')])

      expect((await getArc())?.currentPhase).toBe('exploring')
    })

    it('detects phase from block array content', async () => {
      await initializeArc()
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
      await updateArcPhase([blockMessage as any])

      expect((await getArc())?.currentPhase).toBe('implementing')
    })

    it('progresses phases forward only', async () => {
      await initializeArc()
      await updateArcPhase([createMessage('user', 'Write code')])
      await updateArcPhase([createMessage('user', 'Find file')])

      expect((await getArc())?.currentPhase).toBe('implementing')
    })
  })

  describe('goal management', () => {
    it('adds goal', async () => {
      await initializeArc()
      const goal = await addGoal('Fix the bug')
      expect(goal.description).toBe('Fix the bug')
      expect(goal.status).toBe('pending')
    })

    it('updates goal status', async () => {
      await initializeArc()
      const goal = await addGoal('Test feature')
      await updateGoalStatus(goal.id, 'completed')

      const updated = (await getArc())?.goals.find(g => g.id === goal.id)
      expect(updated?.status).toBe('completed')
      expect(updated?.completedAt).toBeDefined()
    })
  })

  describe('addDecision', () => {
    it('adds decision', async () => {
      await initializeArc()
      const decision = await addDecision('Use TypeScript', 'Type safety')
      expect(decision.description).toBe('Use TypeScript')
      expect(decision.rationale).toBe('Type safety')
    })
  })

  describe('addMilestone', () => {
    it('adds milestone', async () => {
      await initializeArc()
      const milestone = await addMilestone('Phase 1 complete')
      expect(milestone.description).toBe('Phase 1 complete')
      expect(milestone.achievedAt).toBeDefined()
    })
  })

  describe('getArcSummary', () => {
    it('returns summary string', async () => {
      await initializeArc()
      await addGoal('Test goal')
      const summary = await getArcSummary()

      expect(summary).toContain('Phase:')
      expect(summary).toContain('Goals:')
    })
  })

  describe('getArcStats', () => {
    it('returns statistics', async () => {
      await initializeArc()
      await addGoal('Goal 1')
      await addDecision('Decision 1')

      const stats = await getArcStats()
      expect(stats?.goalCount).toBe(1)
      expect(stats?.decisionCount).toBe(1)
    })
  })
})

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
  finalizeArcTurn,
} from './conversationArc.js'
import { resetGlobalGraph } from './knowledgeGraph.js'

function createMessage(role: string, content: string): any {
  return {
    message: { role, content, id: 'test', type: 'message', created_at: Date.now() },
    sender: role,
  }
}

const ARC_FILENAME = '.arc.json'

describe('conversationArc', () => {
  let memDir: string

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'conversation-arc-test-'))
    resetArc()
    resetGlobalGraph()
  })

  afterEach(() => {
    resetArc()
    resetGlobalGraph()
    rmSync(memDir, { recursive: true, force: true })
  })

  describe('initializeArc', () => {
    it('creates new arc in memory dir', () => {
      const arc = initializeArc(memDir)
      expect(arc).toBeDefined()
      expect(arc.currentPhase).toBe('init')
      expect(arc.id).toContain('arc_')
    })

    it('persists arc to .arc.json', () => {
      initializeArc(memDir)
      const arcPath = join(memDir, ARC_FILENAME)
      expect(existsSync(arcPath)).toBe(true)
      const data = JSON.parse(readFileSync(arcPath, 'utf-8'))
      expect(data.currentPhase).toBe('init')
    })
  })

  describe('getArc', () => {
    it('returns existing arc', () => {
      initializeArc(memDir)
      const arc = getArc()
      expect(arc).not.toBeNull()
    })

    it('loads persisted arc from disk', () => {
      const arc1 = initializeArc(memDir)
      resetArc()
      const arc2 = initializeArc(memDir)
      expect(arc2).not.toBeNull()
      expect(arc2!.id).toBe(arc1.id)
    })
  })

  describe('addGoal', () => {
    it('adds goal and transitions phase', () => {
      const arc = initializeArc(memDir)
      expect(arc.currentPhase).toBe('init')

      addGoal('Fix the payment bug')
      expect(arc.goals.length).toBe(1)
      expect(arc.goals[0].description).toBe('Fix the payment bug')
      expect(arc.goals[0].status).toBe('pending')
      expect(arc.currentPhase).toBe('exploring')
    })

    it('persists goals to disk', () => {
      initializeArc(memDir)
      addGoal('Refactor auth module')
      resetArc()

      const reloaded = initializeArc(memDir)
      expect(reloaded.goals.length).toBe(1)
      expect(reloaded.goals[0].description).toBe('Refactor auth module')
    })
  })

  describe('updateGoalStatus', () => {
    it('marks goal completed and creates milestone', () => {
      initializeArc(memDir)
      const goal = addGoal('Deploy to prod')
      expect(goal.status).toBe('pending')
      expect(goal.completedAt).toBeUndefined()

      updateGoalStatus(goal.id, 'completed')
      expect(goal.status).toBe('completed')
      expect(goal.completedAt).toBeGreaterThan(0)
    })
  })

  describe('updateArcPhase', () => {
    it('detects phase from messages', async () => {
      const arc = initializeArc(memDir)
      expect(arc.currentPhase).toBe('init')

      await updateArcPhase([createMessage('user', 'check the logs for errors')])
      expect(arc.currentPhase).toBe('exploring')

      await updateArcPhase([createMessage('assistant', 'Let me write the fix now')])
      expect(arc.currentPhase).toBe('implementing')

      await updateArcPhase([createMessage('user', 'test the changes')])
      expect(arc.currentPhase).toBe('reviewing')
    })

    it('does not regress phase', async () => {
      const arc = initializeArc(memDir)
      arc.currentPhase = 'implementing'

      await updateArcPhase([createMessage('user', 'start fresh')])
      expect(arc.currentPhase).toBe('implementing')
    })
  })

  describe('addDecision', () => {
    it('adds decision with rationale', () => {
      initializeArc(memDir)
      addDecision('Use PostgreSQL', 'Better JSON support')
      const arc = getArc()!
      expect(arc.decisions.length).toBe(1)
      expect(arc.decisions[0].description).toBe('Use PostgreSQL')
      expect(arc.decisions[0].rationale).toBe('Better JSON support')
    })
  })

  describe('getArcSummary', () => {
    it('returns summary with phase and goal count', async () => {
      initializeArc(memDir)
      addGoal('Fix bug')
      const summary = await getArcSummary()
      expect(summary).toContain('exploring')
      expect(summary).toContain('0/1 completed')
    })
  })

  describe('finalizeArcTurn', () => {
    it('writes session summary file when goals completed', async () => {
      const arc = initializeArc(memDir)
      const goal = addGoal('Implement feature')
      updateGoalStatus(goal.id, 'completed')
      addDecision('Use TypeScript', 'Type safety')

      await finalizeArcTurn()

      const files = readdirSync(memDir).filter(f => f.startsWith('session-summary-'))
      expect(files.length).toBeGreaterThan(0)
      const content = readFileSync(join(memDir, files[0]), 'utf-8')
      expect(content).toContain('Implement feature')
      expect(content).toContain('Use TypeScript')
    })

    it('no-ops when no goals or decisions', async () => {
      initializeArc(memDir)
      await finalizeArcTurn()
      const files = readdirSync(memDir).filter(f => f.startsWith('session-summary-'))
      expect(files.length).toBe(0)
    })
  })

  describe('getArcStats', () => {
    it('returns correct stats', () => {
      initializeArc(memDir)
      addGoal('Goal A')
      addGoal('Goal B')
      addDecision('Decision X')
      addMilestone('Milestone Y')

      const stats = getArcStats()
      expect(stats).not.toBeNull()
      expect(stats!.goalCount).toBe(2)
      expect(stats!.decisionCount).toBe(1)
      expect(stats!.milestoneCount).toBe(1)
      expect(stats!.durationMs).toBeGreaterThanOrEqual(0)
    })
  })
})

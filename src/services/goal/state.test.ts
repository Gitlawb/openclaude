import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_GOAL_MAX_TURNS,
  achieveGoal,
  clearGoal,
  createGoalState,
  markGoalEvaluated,
  pauseGoal,
  prepareGoalForSessionResume,
  resumeGoal,
  shouldEvaluateGoal,
} from './state.js'

const now = '2026-05-21T10:00:00.000Z'
const later = '2026-05-21T10:05:00.000Z'

describe('goal state transitions', () => {
  test('set -> active', () => {
    const goal = createGoalState('ship the feature', now)

    expect(goal.condition).toBe('ship the feature')
    expect(goal.status).toBe('active')
    expect(goal.turnCount).toBe(0)
    expect(goal.maxTurns).toBe(DEFAULT_GOAL_MAX_TURNS)
    expect(goal.evaluatorFailures).toBe(0)
  })

  test('active -> paused', () => {
    const goal = pauseGoal(createGoalState('ship', now), later)

    expect(goal.status).toBe('paused')
    expect(goal.pausedAt).toBe(later)
    expect(goal.updatedAt).toBe(later)
  })

  test('paused -> active resets the active turn baseline', () => {
    const paused = pauseGoal(
      markGoalEvaluated(createGoalState('ship', now), {
        evaluatedMessageUuid: 'assistant-1',
        decision: 'incomplete',
        reason: 'not done',
        nextInstruction: 'keep going',
        now,
      }),
      later,
    )

    const resumed = resumeGoal(paused, '2026-05-21T10:10:00.000Z')

    expect(resumed.status).toBe('active')
    expect(resumed.turnCount).toBe(0)
    expect(resumed.startedAt).toBe('2026-05-21T10:10:00.000Z')
    expect(resumed.lastEvaluatedMessageUuid).toBeUndefined()
    expect(resumed.resumedAt).toBe('2026-05-21T10:10:00.000Z')
  })

  test('active -> achieved', () => {
    const goal = achieveGoal(createGoalState('ship', now), {
      evaluatedMessageUuid: 'assistant-1',
      reason: 'all requested work is done',
      now: later,
    })

    expect(goal.status).toBe('achieved')
    expect(goal.achievedAt).toBe(later)
    expect(goal.turnCount).toBe(1)
    expect(goal.lastDecision).toBe('complete')
    expect(goal.lastReason).toBe('all requested work is done')
  })

  test('active/paused -> cleared', () => {
    const active = createGoalState('ship', now)
    const paused = pauseGoal(active, later)

    expect(clearGoal(active)).toBeNull()
    expect(clearGoal(paused)).toBeNull()
  })

  test('duplicate evaluation guard by lastEvaluatedMessageUuid', () => {
    const goal = markGoalEvaluated(createGoalState('ship', now), {
      evaluatedMessageUuid: 'assistant-1',
      decision: 'incomplete',
      reason: 'not done',
      nextInstruction: null,
      now,
    })

    expect(shouldEvaluateGoal(goal, 'assistant-1')).toBe(false)
    expect(shouldEvaluateGoal(goal, 'assistant-2')).toBe(true)
  })

  test('maxTurns guard', () => {
    const goal = {
      ...createGoalState('ship', now),
      turnCount: DEFAULT_GOAL_MAX_TURNS,
    }

    expect(shouldEvaluateGoal(goal, 'assistant-1')).toBe(false)
  })

  test('session resume resets active goals and does not auto-run inactive goals', () => {
    const active = markGoalEvaluated(createGoalState('ship', now), {
      evaluatedMessageUuid: 'assistant-1',
      decision: 'incomplete',
      reason: 'not done',
      now,
    })
    const restoredActive = prepareGoalForSessionResume(active, later)

    expect(restoredActive?.status).toBe('active')
    expect(restoredActive?.turnCount).toBe(0)
    expect(restoredActive?.startedAt).toBe(later)
    expect(restoredActive?.lastEvaluatedMessageUuid).toBeUndefined()

    const achieved = prepareGoalForSessionResume(
      achieveGoal(createGoalState('ship', now), {
        evaluatedMessageUuid: 'assistant-1',
        reason: 'done',
        now,
      }),
      later,
    )
    const cleared = prepareGoalForSessionResume(
      {
        ...createGoalState('ship', now),
        status: 'cleared',
        clearedAt: later,
      },
      later,
    )

    expect(shouldEvaluateGoal(achieved, 'assistant-2')).toBe(false)
    expect(shouldEvaluateGoal(cleared, 'assistant-2')).toBe(false)
  })
})

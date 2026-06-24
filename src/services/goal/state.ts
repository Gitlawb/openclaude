import { randomUUID } from 'crypto'

import type { GoalDecision, GoalState } from './types.js'

export const DEFAULT_GOAL_MAX_TURNS = 50
export const MAX_GOAL_CONDITION_CHARS = 4_000

export function nowIso(): string {
  return new Date().toISOString()
}

export function normalizeGoalCondition(input: string): string {
  const trimmed = input.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function validateGoalCondition(input: string):
  | { ok: true; condition: string }
  | { ok: false; error: string } {
  const condition = normalizeGoalCondition(input)
  if (!condition) {
    return { ok: false, error: 'Goal condition cannot be empty.' }
  }
  if (condition.length > MAX_GOAL_CONDITION_CHARS) {
    return {
      ok: false,
      error: 'Goal condition must be 4,000 characters or fewer.',
    }
  }
  return { ok: true, condition }
}

export function createGoalState(
  condition: string,
  now: string = nowIso(),
  maxTurns = DEFAULT_GOAL_MAX_TURNS,
): GoalState {
  return {
    id: randomUUID(),
    condition: condition.trim(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    turnCount: 0,
    maxTurns,
    evaluatorFailures: 0,
  }
}

export function pauseGoal(goal: GoalState, now: string = nowIso()): GoalState {
  if (goal.status !== 'active') return goal
  return {
    ...goal,
    status: 'paused',
    pausedAt: now,
    updatedAt: now,
  }
}

export function resumeGoal(goal: GoalState, now: string = nowIso()): GoalState {
  if (goal.status !== 'paused' && goal.status !== 'active') return goal
  return {
    ...goal,
    status: 'active',
    startedAt: now,
    resumedAt: now,
    pausedAt: undefined,
    updatedAt: now,
    turnCount: 0,
    lastEvaluatedMessageUuid: undefined,
  }
}

export function clearGoal(_goal: GoalState | null): null {
  return null
}

export function achieveGoal(
  goal: GoalState,
  opts: {
    evaluatedMessageUuid: string
    reason: string
    nextInstruction?: string | null
    now?: string
  },
): GoalState {
  const now = opts.now ?? nowIso()
  return {
    ...goal,
    status: 'achieved',
    achievedAt: now,
    updatedAt: now,
    turnCount: goal.turnCount + 1,
    lastEvaluatedMessageUuid: opts.evaluatedMessageUuid,
    lastDecision: 'complete',
    lastReason: opts.reason,
    lastNextInstruction: opts.nextInstruction ?? undefined,
  }
}

export function markGoalEvaluated(
  goal: GoalState,
  opts: {
    evaluatedMessageUuid: string
    decision: Exclude<GoalDecision, 'complete'>
    reason: string
    nextInstruction?: string | null
    now?: string
  },
): GoalState {
  const now = opts.now ?? nowIso()
  const evaluatorFailed =
    opts.decision === 'malformed' || opts.decision === 'error'
  return {
    ...goal,
    updatedAt: now,
    turnCount: goal.turnCount + 1,
    lastEvaluatedMessageUuid: opts.evaluatedMessageUuid,
    lastDecision: opts.decision,
    lastReason: opts.reason,
    lastNextInstruction: opts.nextInstruction ?? undefined,
    evaluatorFailures: goal.evaluatorFailures + (evaluatorFailed ? 1 : 0),
  }
}

export function pauseGoalAtMaxTurns(
  goal: GoalState,
  terminalMessageUuid: string,
  now: string = nowIso(),
  evaluatorReason?: string,
): GoalState {
  const maxReason = `Goal paused: after reaching the maximum of ${goal.maxTurns} turns.`
  return {
    ...goal,
    status: 'paused',
    pausedAt: now,
    updatedAt: now,
    lastEvaluatedMessageUuid: terminalMessageUuid,
    lastDecision: 'incomplete',
    lastReason: evaluatorReason
      ? `${maxReason} Last evaluator reason: ${evaluatorReason}`
      : maxReason,
  }
}

export function shouldEvaluateGoal(
  goal: GoalState | null | undefined,
  terminalAssistantMessageUuid: string | undefined,
): boolean {
  if (!goal || goal.status !== 'active') return false
  if (!terminalAssistantMessageUuid) return false
  if (goal.lastEvaluatedMessageUuid === terminalAssistantMessageUuid) {
    return false
  }
  if (goal.turnCount >= goal.maxTurns) return false
  return true
}

export function prepareGoalForSessionResume(
  goal: GoalState | null | undefined,
  now: string = nowIso(),
): GoalState | null {
  if (!goal) return null
  if (goal.status !== 'active') return goal
  return {
    ...goal,
    startedAt: now,
    resumedAt: now,
    updatedAt: now,
    turnCount: 0,
    lastEvaluatedMessageUuid: undefined,
  }
}

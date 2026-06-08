import type { LocalCommandCall } from '../../types/command.js'
import { buildGoalStartInstruction } from '../../services/goal/instructions.js'
import { saveGoalState } from '../../services/goal/persistence.js'
import {
  createGoalState,
  pauseGoal,
  resumeGoal,
  validateGoalCondition,
} from '../../services/goal/state.js'
import type { GoalState } from '../../services/goal/types.js'

type SaveGoalState = typeof saveGoalState

const CLEAR_ALIASES = new Set([
  'clear',
  'stop',
  'off',
  'reset',
  'none',
  'cancel',
])

function formatElapsed(fromIso: string, toIso?: string): string {
  const from = Date.parse(fromIso)
  const to = toIso ? Date.parse(toIso) : Date.now()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'unknown'

  const seconds = Math.max(0, Math.floor((to - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatStatus(goal: GoalState | null): string {
  if (!goal) return 'No goal set.'

  const elapsedEnd =
    goal.status === 'achieved'
      ? goal.achievedAt
      : goal.status === 'paused'
        ? goal.pausedAt
        : undefined

  return [
    `Status: ${goal.status}`,
    `Condition: ${goal.condition}`,
    `Turns: ${goal.turnCount}/${goal.maxTurns}`,
    `Elapsed: ${formatElapsed(goal.startedAt, elapsedEnd)}`,
    `Last evaluator reason: ${goal.lastReason ?? 'none'}`,
    `Evaluator failures: ${goal.evaluatorFailures}`,
  ].join('\n')
}

async function setGoal(
  condition: string,
  context: Parameters<LocalCommandCall>[1],
  persistGoalState: SaveGoalState,
) {
  const goal = createGoalState(condition)
  await persistGoalState(goal)
  context.setAppState(prev => ({ ...prev, goal }))
  return {
    type: 'text' as const,
    value: `Goal set: ${goal.condition}`,
    shouldQuery: true,
    metaMessages: [buildGoalStartInstruction(goal)],
  }
}

export function createGoalCall(
  persistGoalState: SaveGoalState = saveGoalState,
): LocalCommandCall {
  return async (args, context) => {
    const raw = args.trim()
    const action = raw.toLowerCase()
    const currentGoal = context.getAppState().goal ?? null

    if (!raw) {
      return { type: 'text', value: formatStatus(currentGoal) }
    }

    if (action === 'status') {
      return { type: 'text', value: formatStatus(currentGoal) }
    }

    if (CLEAR_ALIASES.has(action)) {
      await persistGoalState(null)
      context.setAppState(prev => ({ ...prev, goal: null }))
      return { type: 'text', value: 'Goal cleared.' }
    }

    if (action === 'pause') {
      if (!currentGoal || currentGoal.status !== 'active') {
        return { type: 'text', value: 'No active goal to pause.' }
      }
      const paused = pauseGoal(currentGoal)
      await persistGoalState(paused)
      context.setAppState(prev => ({ ...prev, goal: paused }))
      return { type: 'text', value: 'Goal paused.' }
    }

    if (action === 'resume') {
      if (!currentGoal) {
        return { type: 'text', value: 'No goal to resume.' }
      }
      if (currentGoal.status !== 'paused' && currentGoal.status !== 'active') {
        return {
          type: 'text',
          value: `Cannot resume a ${currentGoal.status} goal.`,
        }
      }
      const resumed = resumeGoal(currentGoal)
      await persistGoalState(resumed)
      context.setAppState(prev => ({ ...prev, goal: resumed }))
      return {
        type: 'text',
        value:
          currentGoal.status === 'active'
            ? 'Goal already active; continuing.'
            : 'Goal resumed.',
        shouldQuery: true,
        metaMessages: [buildGoalStartInstruction(resumed)],
      }
    }

    const validated = validateGoalCondition(raw)
    if (!validated.ok) {
      return { type: 'text', value: validated.error }
    }

    return setGoal(validated.condition, context, persistGoalState)
  }
}

export const call: LocalCommandCall = createGoalCall()

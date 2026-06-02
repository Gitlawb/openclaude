import type { UUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import type { GoalState } from './types.js'

export async function saveGoalState(goal: GoalState | null): Promise<void> {
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.TEST_ENABLE_SESSION_PERSISTENCE !== 'true'
  ) {
    return
  }
  const { recordGoalState } = await import('../../utils/sessionStorage.js')
  await recordGoalState(goal, getSessionId() as UUID)
}

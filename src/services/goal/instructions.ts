import type { GoalEvaluatorDecision, GoalState } from './types.js'

export function buildGoalStartInstruction(goal: GoalState): string {
  return [
    'A session goal has been set.',
    '',
    `Goal condition:\n${goal.condition}`,
    '',
    'Continue directly toward this goal. Use tools as needed. Do not stop only because one turn ended; stop when the goal is complete, a permission/user decision is needed, or you are blocked.',
  ].join('\n')
}

export function buildGoalContinuationInstruction(
  goal: GoalState,
  decision: GoalEvaluatorDecision,
): string {
  return [
    'Continue working toward the active session goal.',
    '',
    `Goal condition:\n${goal.condition}`,
    '',
    `Evaluator reason:\n${decision.reason}`,
    decision.nextInstruction
      ? `\nEvaluator next instruction:\n${decision.nextInstruction}`
      : '',
    '',
    'Continue directly and use tools as needed. Do not recap unless useful for the work. Preserve normal permission checks.',
  ]
    .filter(Boolean)
    .join('\n')
}

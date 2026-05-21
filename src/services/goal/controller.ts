import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { createSystemMessage, createUserMessage } from '../../utils/messages.js'
import { evaluateGoal as evaluateGoalDefault } from './evaluator.js'
import { buildGoalContinuationInstruction } from './instructions.js'
import { saveGoalState as saveGoalStateDefault } from './persistence.js'
import {
  achieveGoal,
  markGoalEvaluated,
  nowIso,
  pauseGoalAtMaxTurns,
  shouldEvaluateGoal,
} from './state.js'
import type { GoalState } from './types.js'

const GOAL_EVALUATION_MESSAGE_LIMIT = 24

export type GoalEvaluationDeps = {
  evaluateGoal?: typeof evaluateGoalDefault
  saveGoalState?: typeof saveGoalStateDefault
}

export function isMainThreadGoalSource(
  querySource: QuerySource,
  toolUseContext: ToolUseContext,
): boolean {
  if (toolUseContext.agentId) return false
  if (typeof querySource !== 'string') return false
  return querySource === 'sdk' || querySource.startsWith('repl_main_thread')
}

function hasPendingInteractiveDialog(toolUseContext: ToolUseContext): boolean {
  const state = toolUseContext.getAppState()
  return Boolean(
    state.elicitation?.queue?.length ||
      state.pendingWorkerRequest ||
      state.pendingSandboxRequest ||
      state.activeOverlays?.size,
  )
}

function terminalAssistantUuid(assistantMessages: Message[]): string | undefined {
  return assistantMessages.at(-1)?.uuid
}

function getRecentGoalEvaluationMessages(
  messagesForQuery: Message[],
  assistantMessages: Message[],
): Message[] {
  return [
    ...messagesForQuery.slice(-GOAL_EVALUATION_MESSAGE_LIMIT),
    ...assistantMessages.slice(-GOAL_EVALUATION_MESSAGE_LIMIT),
  ].slice(-GOAL_EVALUATION_MESSAGE_LIMIT)
}

async function persistGoal(
  saveGoalState: typeof saveGoalStateDefault,
  goal: GoalState | null,
): Promise<void> {
  try {
    await saveGoalState(goal)
  } catch {
    // Goal persistence is important for resume, but should not crash a turn.
  }
}

export async function* evaluateGoalAfterTurn({
  messagesForQuery,
  assistantMessages,
  toolUseContext,
  querySource,
  deps = {},
}: {
  messagesForQuery: Message[]
  assistantMessages: Message[]
  toolUseContext: ToolUseContext
  querySource: QuerySource
  deps?: GoalEvaluationDeps
}): AsyncGenerator<Message, Message[]> {
  const evaluateGoal = deps.evaluateGoal ?? evaluateGoalDefault
  const saveGoalState = deps.saveGoalState ?? saveGoalStateDefault
  const terminalUuid = terminalAssistantUuid(assistantMessages)
  const appState = toolUseContext.getAppState()
  const goal = appState.goal ?? null

  if (!isMainThreadGoalSource(querySource, toolUseContext)) return []
  if (!goal || goal.status !== 'active') return []
  if (!terminalUuid) return []
  if (goal.lastEvaluatedMessageUuid === terminalUuid) return []
  if (toolUseContext.abortController.signal.aborted) return []
  if (hasPendingInteractiveDialog(toolUseContext)) return []

  if (goal.turnCount >= goal.maxTurns) {
    const paused = pauseGoalAtMaxTurns(goal, terminalUuid, nowIso())
    toolUseContext.setAppState(prev => ({ ...prev, goal: paused }))
    await persistGoal(saveGoalState, paused)
    yield createSystemMessage(paused.lastReason ?? 'Goal paused.', 'warning')
    return []
  }
  if (!shouldEvaluateGoal(goal, terminalUuid)) return []

  const decision = await evaluateGoal({
    goal,
    messages: getRecentGoalEvaluationMessages(
      messagesForQuery,
      assistantMessages,
    ),
    signal: toolUseContext.abortController.signal,
    isNonInteractiveSession:
      toolUseContext.options.isNonInteractiveSession ?? false,
  })

  if (toolUseContext.abortController.signal.aborted) return []

  if (decision.complete) {
    const achieved = achieveGoal(goal, {
      evaluatedMessageUuid: terminalUuid,
      reason: decision.reason,
      nextInstruction: decision.nextInstruction,
    })
    toolUseContext.setAppState(prev => ({ ...prev, goal: achieved }))
    await persistGoal(saveGoalState, achieved)
    yield createSystemMessage(`Goal achieved: ${decision.reason}`, 'info')
    return []
  }

  const updatedGoal = markGoalEvaluated(goal, {
    evaluatedMessageUuid: terminalUuid,
    decision: decision.decision === 'complete' ? 'incomplete' : decision.decision,
    reason: decision.reason,
    nextInstruction: decision.nextInstruction,
  })

  if (updatedGoal.turnCount >= updatedGoal.maxTurns) {
    const paused = pauseGoalAtMaxTurns(
      updatedGoal,
      terminalUuid,
      nowIso(),
      decision.reason,
    )
    toolUseContext.setAppState(prev => ({ ...prev, goal: paused }))
    await persistGoal(saveGoalState, paused)
    yield createSystemMessage(
      `Goal not complete: ${decision.reason} Goal paused after reaching the maximum of ${updatedGoal.maxTurns} turns.`,
      'warning',
    )
    return []
  }

  toolUseContext.setAppState(prev => ({ ...prev, goal: updatedGoal }))
  await persistGoal(saveGoalState, updatedGoal)
  yield createSystemMessage(`Goal not complete: ${decision.reason}`, 'info')

  return [
    createUserMessage({
      content: buildGoalContinuationInstruction(updatedGoal, decision),
      isMeta: true,
    }),
  ]
}

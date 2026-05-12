import type { Message, ToolUseSummaryMessage } from '../types/message.js'
import { type ToolUseContext } from '../Tool.js'
import type { AutoCompactTrackingState } from '../services/compact/autoCompact.js'
import type { QuerySource } from '../constants/querySource.js'
import type { QueryDeps } from './deps.js'
import type { Continue } from './transitions.js'
import { type SystemPrompt } from '../utils/systemPromptType.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'

export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  // API task_budget (output_config.task_budget, beta task-budgets-2026-03-13).
  // Distinct from the tokenBudget +500k auto-continue feature. `total` is the
  // budget for the whole agentic turn; `remaining` is computed per iteration
  // from cumulative API usage. See configureTaskBudgetParams in claude.ts.
  taskBudget?: { total: number }
  deps?: QueryDeps
}

// Mutable state carried between loop iterations
export type SessionState = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  // Count of consecutive continuation nudges within the current turn.
  // Capped at MAX_CONTINUATION_NUDGES to prevent infinite nudge loops
  // when the model keeps matching continuation signals without tool calls.
  continuationNudgeCount: number
  // Why the previous iteration continued. Undefined on first iteration.
  // Lets tests assert recovery paths fired without inspecting message contents.
  transition: Continue | undefined
}

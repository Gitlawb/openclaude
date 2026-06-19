/**
 * Inert stub for periodic background-session task summaries (`claude ps`).
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where `feature('BG_SESSIONS')` is
 * disabled. This module preserves that behavior: no summaries are ever
 * generated and no import-time side effects occur.
 */

import type { ToolUseContext } from '../Tool.js'
import type { Message } from '../types/message.js'
import type { SystemPrompt } from './systemPromptType.js'

/**
 * Whether a periodic task summary should be generated now.
 * Inert: always false, so `maybeGenerateTaskSummary` is never reached.
 */
export function shouldGenerateTaskSummary(): boolean {
  return false
}

/**
 * Fire-and-forget generation of a task summary for `claude ps`.
 * Inert: no-op.
 */
export function maybeGenerateTaskSummary(_params: {
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  forkContextMessages: Message[]
}): void {
  // no-op
}

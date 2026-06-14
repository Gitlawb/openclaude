import type { Message } from '../../types/message.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'

/** Collapse when projected context exceeds this fraction; size the span to drop under it. */
export const COLLAPSE_TARGET_RATIO = 0.7
/** Most-recent fraction of the window that is never collapsed (the working set). */
export const PROTECTED_TAIL_RATIO = 0.3
/** Below this many estimated tokens, a span is not worth a model call. */
export const MIN_COLLAPSE_TOKENS = 2000

/** A user message carrying a tool_result block (the back half of a tool exchange). */
export function isToolResultMessage(msg: Message): boolean {
  if (msg.type !== 'user') return false
  const content = (msg as { message?: { content?: unknown } }).message?.content
  if (!Array.isArray(content)) return false
  return content.some(
    (block: unknown) =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'tool_result',
  )
}

/** Start of a real conversational turn: a non-meta user message that is not a tool_result. */
export function isTurnStart(msg: Message): boolean {
  return msg.type === 'user' && !(msg as { isMeta?: boolean }).isMeta && !isToolResultMessage(msg)
}

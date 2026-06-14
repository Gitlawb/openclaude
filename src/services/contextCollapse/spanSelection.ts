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

export type SelectedSpan = {
  startUuid: string
  endUuid: string
  startIndex: number
  tokenEstimate: number
}

/**
 * Pick ONE oldest collapsible span of whole turns.
 *
 * Protects the first turn (task framing) and the most-recent PROTECTED_TAIL_RATIO
 * of the window (the working set). Anchors both boundaries on turn-starts so a
 * tool_use/tool_result pair is never split. Grows the span turn-by-turn until the
 * projected post-collapse total drops under COLLAPSE_TARGET_RATIO of the window.
 * Returns null when there is no candidate or the span is below MIN_COLLAPSE_TOKENS.
 *
 * `estimateTokens` is injectable for deterministic tests; defaults to the real estimator.
 */
export function selectCollapseSpan(
  messages: Message[],
  effectiveWindow: number,
  estimateTokens: (msgs: Message[]) => number = tokenCountWithEstimation,
): SelectedSpan | null {
  if (messages.length === 0 || effectiveWindow <= 0) return null

  // Protected head: index of the first real turn-start.
  const headIdx = messages.findIndex(isTurnStart)
  if (headIdx === -1) return null

  // Protected tail: walk from the end accumulating tokens until we've reserved
  // PROTECTED_TAIL_RATIO of the window, then snap forward to a turn-start so the
  // span ends cleanly just before a turn.
  const tailBudget = effectiveWindow * PROTECTED_TAIL_RATIO
  let tailTokens = 0
  let tailStartIdx = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    tailTokens += estimateTokens([messages[i]!])
    tailStartIdx = i
    if (tailTokens >= tailBudget) break
  }
  while (tailStartIdx < messages.length && !isTurnStart(messages[tailStartIdx]!)) {
    tailStartIdx++
  }

  // Candidate region begins at the first turn-start AFTER the protected head.
  let candidateStart = -1
  for (let i = headIdx + 1; i < tailStartIdx; i++) {
    if (isTurnStart(messages[i]!)) {
      candidateStart = i
      break
    }
  }
  if (candidateStart === -1) return null

  // Grow the span turn-by-turn until projected total < target.
  const total = estimateTokens(messages)
  const target = effectiveWindow * COLLAPSE_TARGET_RATIO
  let endIdx = candidateStart
  let spanTokens = 0
  let i = candidateStart
  while (i < tailStartIdx) {
    let next = i + 1
    while (next < tailStartIdx && !isTurnStart(messages[next]!)) next++
    endIdx = next - 1
    spanTokens = estimateTokens(messages.slice(candidateStart, endIdx + 1))
    if (total - spanTokens < target) break
    i = next
  }

  if (spanTokens < MIN_COLLAPSE_TOKENS) return null

  return {
    startUuid: messages[candidateStart]!.uuid as string,
    endUuid: messages[endIdx]!.uuid as string,
    startIndex: candidateStart,
    tokenEstimate: spanTokens,
  }
}

/** Drain-priority score in [0,1]: blends span age (older = higher) and size (bigger = higher). */
export function computeRisk(
  startIndex: number,
  totalMessages: number,
  spanTokens: number,
  effectiveWindow: number,
): number {
  const ageFactor = totalMessages > 0 ? 1 - startIndex / totalMessages : 0
  const sizeFactor = effectiveWindow > 0 ? Math.min(spanTokens / effectiveWindow, 1) : 0
  const risk = 0.5 * ageFactor + 0.5 * sizeFactor
  return Math.max(0, Math.min(1, risk))
}

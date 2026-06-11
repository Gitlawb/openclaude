// Stub — contextCollapse not included in source snapshot (feature-gated).
// All paths are behind feature('CONTEXT_COLLAPSE') + isContextCollapseEnabled(),
// which returns false here, so these inert implementations preserve behavior.
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
} from '../../types/message.js'

export function isContextCollapseEnabled(): boolean {
  return false
}

export function getContextCollapseState() {
  return null
}

/** Spawn/error health counters surfaced in /context and the token warning. */
export type ContextCollapseHealth = {
  totalSpawns: number
  totalErrors: number
  totalEmptySpawns: number
  lastError: string | null
  emptySpawnWarningEmitted: boolean
}

export type ContextCollapseStats = {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: ContextCollapseHealth
}

const INERT_STATS: ContextCollapseStats = {
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalSpawns: 0,
    totalErrors: 0,
    totalEmptySpawns: 0,
    lastError: null,
    emptySpawnWarningEmitted: false,
  },
}

/** One-time startup hook (setup.ts). No-op in this snapshot. */
export function initContextCollapse(): void {}

export function getStats(): ContextCollapseStats {
  return INERT_STATS
}

/**
 * useSyncExternalStore-compatible subscription. The store never mutates in
 * this snapshot, so the listener is never invoked.
 */
export function subscribe(_listener: () => void): () => void {
  return () => {}
}

/** Reset collapse state after a full compaction or rewind. No-op here. */
export function resetContextCollapse(): void {}

/**
 * Apply any staged collapses before the API call. Inert: returns the
 * input messages unchanged.
 */
export async function applyCollapsesIfNeeded(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
): Promise<{ messages: Message[] }> {
  return { messages }
}

/**
 * Whether a prompt-too-long error should be withheld pending a collapse
 * drain. Always false — nothing is ever staged in this snapshot.
 */
export function isWithheldPromptTooLong(
  _message: Message | StreamEvent | undefined,
  _isPromptTooLongMessage: (msg: AssistantMessage) => boolean,
  _querySource: QuerySource,
): boolean {
  return false
}

/**
 * Drain staged collapses to recover from a context overflow. Inert: nothing
 * staged, so nothing is committed and messages pass through unchanged.
 */
export function recoverFromOverflow(
  messages: Message[],
  _querySource: QuerySource,
): { messages: Message[]; committed: number } {
  return { messages, committed: 0 }
}

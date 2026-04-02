import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'

type CollapseStats = {
  collapsedSpans: number
  stagedSpans: number
  collapsedMessages: number
  health: {
    totalSpawns: number
    totalErrors: number
    totalEmptySpawns: number
    emptySpawnWarningEmitted: boolean
    lastError?: string
  }
}

type Listener = () => void

const listeners = new Set<Listener>()
const stats: CollapseStats = {
  collapsedSpans: 0,
  stagedSpans: 0,
  collapsedMessages: 0,
  health: {
    totalSpawns: 0,
    totalErrors: 0,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  },
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function isContextCollapseEnabled(): boolean {
  return false
}

export function getContextCollapseState(): null {
  return null
}

export function getStats(): CollapseStats {
  return {
    ...stats,
    health: { ...stats.health },
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function initContextCollapse(): void {
  emit()
}

export function resetContextCollapse(): void {
  stats.collapsedSpans = 0
  stats.stagedSpans = 0
  stats.collapsedMessages = 0
  stats.health.totalSpawns = 0
  stats.health.totalErrors = 0
  stats.health.totalEmptySpawns = 0
  stats.health.emptySpawnWarningEmitted = false
  stats.health.lastError = undefined
  emit()
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
): Promise<{ messages: Message[] }> {
  return { messages }
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource: QuerySource,
): { messages: Message[]; committed: number } {
  return {
    messages,
    committed: 0,
  }
}

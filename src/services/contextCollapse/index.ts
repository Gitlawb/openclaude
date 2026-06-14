import { randomUUID } from 'crypto'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
} from '../../types/message.js'
import { logError } from '../../utils/log.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { selectCollapseSpan, computeRisk } from './spanSelection.js'
import { CTX_AGENT_INSTRUCTION } from './ctxAgentPrompt.js'
import {
  buildCollapsePlaceholder,
  deriveCollapseId,
  resetCollapseIdCounter,
} from './collapseUtils.js'

import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../../types/logs.js'

// ── Internal types ──────────────────────────────────────────────────────────

type CommittedCollapse = {
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
  archived: Message[]
}

type StagedSpan = {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
  stagedAt: number
}

// ── Public types ────────────────────────────────────────────────────────────

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

// ── Module-level state ─────────────────────────────────────────────────────

let commitLog: CommittedCollapse[] = []
let stagedQueue: StagedSpan[] = []
let uuidToCollapseId: Map<string, string> = new Map()
let collapseIdToUuid: Map<string, string> = new Map()
let enabled = false
let armed = false
let lastSpawnTokens = 0
let health: ContextCollapseHealth = {
  totalSpawns: 0,
  totalErrors: 0,
  totalEmptySpawns: 0,
  lastError: null,
  emptySpawnWarningEmitted: false,
}
let listeners: Set<() => void> = new Set()
let spawnInProgress = false

// ── Public API ──────────────────────────────────────────────────────────────

export function isContextCollapseEnabled(): boolean {
  return enabled
}

export function getContextCollapseState(): {
  committedSpans: number
  stagedSpans: number
  armed: boolean
  lastSpawnTokens: number
  health: ContextCollapseHealth
} | null {
  if (!enabled) return null
  return {
    committedSpans: commitLog.length,
    stagedSpans: stagedQueue.length,
    armed,
    lastSpawnTokens,
    health: { ...health },
  }
}

export function initContextCollapse(): void {
  const envOverride = typeof process !== 'undefined'
    ? process.env.CLAUDE_CONTEXT_COLLAPSE
    : undefined
  if (envOverride === '0' || envOverride === 'false') {
    enabled = false
    armed = false
    return
  }
  enabled = true
  armed = true
}

export function getStats(): ContextCollapseStats {
  let collapsedMessages = 0
  for (const c of commitLog) {
    collapsedMessages += c.archived.length
  }
  return {
    collapsedSpans: commitLog.length,
    collapsedMessages,
    stagedSpans: stagedQueue.length,
    health: { ...health },
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function resetContextCollapse(): void {
  commitLog = []
  stagedQueue = []
  uuidToCollapseId = new Map()
  collapseIdToUuid = new Map()
  health = {
    totalSpawns: 0,
    totalErrors: 0,
    totalEmptySpawns: 0,
    lastError: null,
    emptySpawnWarningEmitted: false,
  }
  armed = false
  lastSpawnTokens = 0
  spawnInProgress = false
  resetCollapseIdCounter()
  notifyListeners()
}

// ── Core collapse algorithm ─────────────────────────────────────────────────

export async function applyCollapsesIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
): Promise<{ messages: Message[] }> {
  if (!enabled) return { messages }
  if (querySource === 'marble_origami') return { messages }

  // Commit drain: process all staged spans
  if (stagedQueue.length > 0) {
    messages = drainStaged(messages, true)
  }

  // Spawn check: at ~95% of effective window, block and spawn ctx-agent
  messages = await maybeSpawnCtxAgent(messages, toolUseContext, querySource)

  return { messages }
}

export function isWithheldPromptTooLong(
  message: Message | StreamEvent | undefined,
  isPromptTooLongMessage: (msg: AssistantMessage) => boolean,
  _querySource: QuerySource,
): boolean {
  if (!enabled) return false
  if (stagedQueue.length === 0) return false
  if (!message || message.type !== 'assistant') return false
  return isPromptTooLongMessage(message as AssistantMessage)
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource: QuerySource,
): { messages: Message[]; committed: number } {
  if (!enabled) return { messages, committed: 0 }

  const beforeCount = commitLog.length
  messages = drainStaged(messages, true)
  const committed = commitLog.length - beforeCount

  return { messages, committed }
}

// ── Drain staged collapses ──────────────────────────────────────────────────

function drainStaged(
  messages: Message[],
  persist: boolean,
): Message[] {
  const processed: StagedSpan[] = []

  for (const span of stagedQueue.sort((a, b) => a.stagedAt - b.stagedAt)) {
    const firstIdx = messages.findIndex(m => m.uuid === span.startUuid)
    const lastIdx = findLastIndex(messages, m => m.uuid === span.endUuid)

    if (firstIdx === -1 || lastIdx === -1 || firstIdx > lastIdx) continue

    const archived = messages.slice(firstIdx, lastIdx + 1)
    const collapseId = deriveCollapseId(span.startUuid)
    const summaryUuid = randomUUID()
    const summaryContent = buildCollapsePlaceholder(collapseId, span.summary)

    const placeholder: Message = {
      type: 'system',
      subtype: 'informational',
      content: summaryContent,
      uuid: summaryUuid,
      timestamp: new Date().toISOString(),
      isMeta: true,
    } as Message

    const committed: CommittedCollapse = {
      collapseId,
      summaryUuid,
      summaryContent,
      summary: span.summary,
      firstArchivedUuid: span.startUuid,
      lastArchivedUuid: span.endUuid,
      archived,
    }

    commitLog.push(committed)
    uuidToCollapseId.set(summaryUuid, collapseId)
    collapseIdToUuid.set(collapseId, summaryUuid)

    messages = [
      ...messages.slice(0, firstIdx),
      placeholder,
      ...messages.slice(lastIdx + 1),
    ]

    processed.push(span)
  }

  if (processed.length > 0) {
    stagedQueue = stagedQueue.filter(s => !processed.includes(s))

    if (persist) {
      persistCommits(processed.length - (stagedQueue.length > 0 ? 0 : 0)).catch(
        () => {},
      )
      persistSnapshot().catch(() => {})
    }

    notifyListeners()
  }

  return messages
}

// ── Spawn mechanism ─────────────────────────────────────────────────────────

const SPAWN_THRESHOLD_RATIO = 0.95 // 95% of effective window triggers spawn

async function maybeSpawnCtxAgent(
  messages: Message[],
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
): Promise<Message[]> {
  if (!armed) return messages
  if (spawnInProgress) return messages
  if (querySource === 'marble_origami') return messages

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getEffectiveContextWindowSize } =
    require('../compact/autoCompact.js') as typeof import('../compact/autoCompact.js')
  const { tokenCountWithEstimation } =
    require('../../utils/tokens.js') as typeof import('../../utils/tokens.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const model = toolUseContext.options.mainLoopModel ?? 'claude-sonnet-4'
  const effectiveWindow = getEffectiveContextWindowSize(model)
  const currentTokens = tokenCountWithEstimation(messages)
  const threshold = Math.floor(effectiveWindow * SPAWN_THRESHOLD_RATIO)

  if (currentTokens < threshold) return messages

  // Don't re-spawn within the same token band unless we have new staged results
  if (
    lastSpawnTokens > 0 &&
    currentTokens <= lastSpawnTokens + 500 &&
    stagedQueue.length === 0
  ) {
    return messages
  }

  spawnInProgress = true
  health.totalSpawns++

  try {
    const spawnedSpans = await spawnCtxAgent(messages, toolUseContext, effectiveWindow)

    if (!spawnedSpans || spawnedSpans.length === 0) {
      health.totalEmptySpawns++
      if (!health.emptySpawnWarningEmitted) {
        health.emptySpawnWarningEmitted = true
      }
    } else {
      for (const span of spawnedSpans) {
        stagedQueue.push(span)
      }
      // Commit immediately after spawn at 95%
      messages = drainStaged(messages, true)
    }

    lastSpawnTokens = currentTokens
    await persistSnapshot()
  } catch (err) {
    health.totalErrors++
    health.lastError = String(err)
    logError(`contextCollapse spawn failed: ${String(err)}`)
  } finally {
    spawnInProgress = false
    notifyListeners()
  }

  return messages
}

const denyCtxAgentTools: CanUseToolFn = async () => ({
  behavior: 'deny' as const,
  message: 'Tool use is not allowed during context collapse',
  decisionReason: {
    type: 'other' as const,
    reason: 'ctx-agent should only produce a text summary',
  },
})

async function spawnCtxAgent(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  effectiveWindow: number,
): Promise<StagedSpan[]> {
  const span = selectCollapseSpan(messages, effectiveWindow)
  if (!span) return []

  const startIdx = messages.findIndex(m => (m.uuid as string) === span.startUuid)
  const endIdx = messages.findIndex(m => (m.uuid as string) === span.endUuid)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return []
  const spanMessages = messages.slice(startIdx, endIdx + 1)

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { runForkedAgent, getLastCacheSafeParams } =
    require('../../utils/forkedAgent.js') as typeof import('../../utils/forkedAgent.js')
  const { createUserMessage, getLastAssistantMessage, getAssistantMessageText } =
    require('../../utils/messages.js') as typeof import('../../utils/messages.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const base = getLastCacheSafeParams()
  if (!base) return []
  const cacheSafeParams = { ...base, forkContextMessages: spanMessages }

  const result = await runForkedAgent({
    promptMessages: [createUserMessage({ content: CTX_AGENT_INSTRUCTION })],
    cacheSafeParams,
    canUseTool: denyCtxAgentTools,
    querySource: 'marble_origami',
    forkLabel: 'ctx-collapse',
    maxTurns: 1,
    skipCacheWrite: true,
  })

  const assistantMsg = getLastAssistantMessage(result.messages)
  const summary = assistantMsg ? getAssistantMessageText(assistantMsg) : null
  if (!assistantMsg || !summary || assistantMsg.isApiErrorMessage) return []
  const trimmed = summary.trim()
  if (!trimmed) return []

  const risk = computeRisk(startIdx, messages.length, span.tokenEstimate, effectiveWindow)
  return [
    {
      startUuid: span.startUuid,
      endUuid: span.endUuid,
      summary: trimmed,
      risk,
      stagedAt: Date.now(),
    },
  ]
}

// ── Persistence helpers ─────────────────────────────────────────────────────

async function persistCommits(count: number): Promise<void> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { recordContextCollapseCommit } =
    require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const start = Math.max(0, commitLog.length - count)
  for (let i = start; i < commitLog.length; i++) {
    const c = commitLog[i]!
    await recordContextCollapseCommit({
      collapseId: c.collapseId,
      summaryUuid: c.summaryUuid,
      summaryContent: c.summaryContent,
      summary: c.summary,
      firstArchivedUuid: c.firstArchivedUuid,
      lastArchivedUuid: c.lastArchivedUuid,
    })
  }
}

async function persistSnapshot(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { recordContextCollapseSnapshot } =
    require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  await recordContextCollapseSnapshot({
    staged: stagedQueue.map(s => ({
      startUuid: s.startUuid,
      endUuid: s.endUuid,
      summary: s.summary,
      risk: s.risk,
      stagedAt: s.stagedAt,
    })),
    armed,
    lastSpawnTokens,
  })
}

// ── Read-side projection (called by operations.ts) ─────────────────────────

export function getCommitLogForProjection(): ReadonlyArray<{
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
  archived: Message[]
}> {
  return commitLog
}

// ── Persist restore (called by persist.ts) ──────────────────────────────────

export function restoreContextCollapseState(
  commits: ContextCollapseCommitEntry[],
  snapshot: ContextCollapseSnapshotEntry | undefined,
): void {
  commitLog = []
  stagedQueue = []
  uuidToCollapseId = new Map()
  collapseIdToUuid = new Map()

  let maxCollapseId = 0

  for (const entry of commits) {
    const collapseIdNum = parseInt(entry.collapseId, 10)
    if (collapseIdNum > maxCollapseId) {
      maxCollapseId = collapseIdNum
    }

    const c: CommittedCollapse = {
      collapseId: entry.collapseId,
      summaryUuid: entry.summaryUuid,
      summaryContent: entry.summaryContent,
      summary: entry.summary,
      firstArchivedUuid: entry.firstArchivedUuid,
      lastArchivedUuid: entry.lastArchivedUuid,
      archived: [],
    }

    commitLog.push(c)
    uuidToCollapseId.set(entry.summaryUuid, entry.collapseId)
    collapseIdToUuid.set(entry.collapseId, entry.summaryUuid)
  }

  resetCollapseIdCounter(maxCollapseId)

  if (snapshot) {
    stagedQueue = snapshot.staged.map(s => ({
      startUuid: s.startUuid,
      endUuid: s.endUuid,
      summary: s.summary,
      risk: s.risk,
      stagedAt: s.stagedAt,
    }))
    armed = snapshot.armed
    lastSpawnTokens = snapshot.lastSpawnTokens
  }

  notifyListeners()
}

// ── Utility ─────────────────────────────────────────────────────────────────

function findLastIndex<T>(
  arr: T[],
  predicate: (item: T) => boolean,
): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i
  }
  return -1
}

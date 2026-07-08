import { feature } from "bun:bundle"
import type { APIError } from "@anthropic-ai/sdk"
import { randomUUID, type UUID } from "crypto"
import type { Message, NormalizedMessage, StopHookInfo, SystemAgentsKilledMessage, SystemAPIErrorMessage, SystemApiMetricsMessage, SystemAwaySummaryMessage, SystemBridgeStatusMessage, SystemCompactBoundaryMessage, SystemInformationalMessage, SystemLocalCommandMessage, SystemMemorySavedMessage, SystemMicrocompactBoundaryMessage, SystemPermissionRetryMessage, SystemScheduledTaskFireMessage, SystemStopHookSummaryMessage, SystemTurnDurationMessage, SystemMessageLevel } from "../../types/message.js"
import { formatTokens } from "../format.js"
import { logForDebugging } from "../debug.js"

export function createSystemMessage(
  content: string,
  level: SystemMessageLevel,
  toolUseID?: string,
  preventContinuation?: boolean,
): SystemInformationalMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    toolUseID,
    level,
    ...(preventContinuation && { preventContinuation }),
  }
}

export function createPermissionRetryMessage(
  commands: string[],
): SystemPermissionRetryMessage {
  return {
    type: 'system',
    subtype: 'permission_retry',
    content: `Allowed ${commands.join(', ')}`,
    commands,
    level: 'info',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

export function createBridgeStatusMessage(
  url: string,
  upgradeNudge?: string,
): SystemBridgeStatusMessage {
  return {
    type: 'system',
    subtype: 'bridge_status',
    content: `/remote-control is active. Code in CLI or at ${url}`,
    url,
    upgradeNudge,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

export function createScheduledTaskFireMessage(
  content: string,
): SystemScheduledTaskFireMessage {
  return {
    type: 'system',
    subtype: 'scheduled_task_fire',
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

export function createStopHookSummaryMessage(
  hookCount: number,
  hookInfos: StopHookInfo[],
  hookErrors: string[],
  preventedContinuation: boolean,
  stopReason: string | undefined,
  hasOutput: boolean,
  level: SystemMessageLevel,
  toolUseID?: string,
  hookLabel?: string,
  totalDurationMs?: number,
): SystemStopHookSummaryMessage {
  return {
    type: 'system',
    subtype: 'stop_hook_summary',
    hookCount,
    hookInfos,
    hookErrors,
    preventedContinuation,
    stopReason,
    hasOutput,
    level,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    toolUseID,
    hookLabel,
    totalDurationMs,
  }
}

export function createTurnDurationMessage(
  durationMs: number,
  budget?: { tokens: number; limit: number; nudges: number },
  messageCount?: number,
): SystemTurnDurationMessage {
  return {
    type: 'system',
    subtype: 'turn_duration',
    durationMs,
    budgetTokens: budget?.tokens,
    budgetLimit: budget?.limit,
    budgetNudges: budget?.nudges,
    messageCount,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createAwaySummaryMessage(
  content: string,
): SystemAwaySummaryMessage {
  return {
    type: 'system',
    subtype: 'away_summary',
    content,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createMemorySavedMessage(
  writtenPaths: string[],
): SystemMemorySavedMessage {
  return {
    type: 'system',
    subtype: 'memory_saved',
    writtenPaths,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createAgentsKilledMessage(): SystemAgentsKilledMessage {
  return {
    type: 'system',
    subtype: 'agents_killed',
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createApiMetricsMessage(metrics: {
  ttftMs: number
  otps: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
}): SystemApiMetricsMessage {
  return {
    type: 'system',
    subtype: 'api_metrics',
    ttftMs: metrics.ttftMs,
    otps: metrics.otps,
    isP50: metrics.isP50,
    hookDurationMs: metrics.hookDurationMs,
    turnDurationMs: metrics.turnDurationMs,
    toolDurationMs: metrics.toolDurationMs,
    classifierDurationMs: metrics.classifierDurationMs,
    toolCount: metrics.toolCount,
    hookCount: metrics.hookCount,
    classifierCount: metrics.classifierCount,
    configWriteCount: metrics.configWriteCount,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createCommandInputMessage(
  content: string,
): SystemLocalCommandMessage {
  return {
    type: 'system',
    subtype: 'local_command',
    content,
    level: 'info',
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createCompactBoundaryMessage(
  trigger: 'manual' | 'auto',
  preTokens: number,
  lastPreCompactMessageUuid?: UUID,
  userContext?: string,
  messagesSummarized?: number,
): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: `Conversation compacted`,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger,
      preTokens,
      userContext,
      messagesSummarized,
    },
    ...(lastPreCompactMessageUuid && {
      logicalParentUuid: lastPreCompactMessageUuid,
    }),
  }
}

export function createMicrocompactBoundaryMessage(
  trigger: 'auto',
  preTokens: number,
  tokensSaved: number,
  compactedToolIds: string[],
  clearedAttachmentUUIDs: string[],
): SystemMicrocompactBoundaryMessage {
  logForDebugging(
    `[microcompact] saved ~${formatTokens(tokensSaved)} tokens (cleared ${compactedToolIds.length} tool results)`,
  )
  return {
    type: 'system',
    subtype: 'microcompact_boundary',
    content: 'Context microcompacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    microcompactMetadata: {
      trigger,
      preTokens,
      tokensSaved,
      compactedToolIds,
      clearedAttachmentUUIDs,
    },
  }
}

export function createSystemAPIErrorMessage(
  error: APIError,
  retryInMs: number,
  retryAttempt: number,
  maxRetries: number,
): SystemAPIErrorMessage {
  return {
    type: 'system',
    subtype: 'api_error',
    level: 'error',
    cause: error.cause instanceof Error ? error.cause : undefined,
    error,
    retryInMs,
    retryAttempt,
    maxRetries,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

/**
 * Checks if a message is a compact boundary marker
 */
export function isCompactBoundaryMessage(
  message: Message | NormalizedMessage,
): message is SystemCompactBoundaryMessage {
  return message?.type === 'system' && message.subtype === 'compact_boundary'
}

/**
 * Finds the index of the last compact boundary marker in the messages array
 * @returns The index of the last compact boundary, or -1 if none found
 */
export function findLastCompactBoundaryIndex<
  T extends Message | NormalizedMessage,
>(messages: T[]): number {
  // Scan backwards to find the most recent compact boundary
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && isCompactBoundaryMessage(message)) {
      return i
    }
  }
  return -1 // No boundary found
}

/**
 * Returns messages from the last compact boundary onward (including the boundary).
 * If no boundary exists, returns all messages.
 *
 * Also filters snipped messages by default (when HISTORY_SNIP is enabled) —
 * the REPL keeps full history for UI scrollback, so model-facing paths need
 * both compact-slice AND snip-filter applied. Pass `{ includeSnipped: true }`
 * to opt out (e.g., REPL.tsx fullscreen compact handler which preserves
 * snipped messages in scrollback).
 *
 * Note: The boundary itself is a system message and will be filtered by normalizeMessagesForAPI.
 */
export function getMessagesAfterCompactBoundary<
  T extends Message | NormalizedMessage,
>(messages: T[], options?: { includeSnipped?: boolean }): T[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  const sliced = boundaryIndex === -1 ? messages : messages.slice(boundaryIndex)
  if (!options?.includeSnipped && feature('HISTORY_SNIP')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { projectSnippedView } =
      require('../../services/compact/snipProjection.js') as typeof import('../../services/compact/snipProjection.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return projectSnippedView(sliced as Message[]) as T[]
  }
  return sliced
}

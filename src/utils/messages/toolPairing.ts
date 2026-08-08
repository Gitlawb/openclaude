import type { Message, UserMessage, AssistantMessage } from '../../types/message.js'
import { logForDebugging } from '../debug.js'

export type ToolResultPairingValidationContext = {
  phase?: string
  querySource?: string
  agentId?: string
  model?: string
  provider?: string
}

export type ToolResultPairingIssueKind =
  | 'missing_tool_result'
  | 'orphaned_tool_result'
  | 'duplicate_tool_use'
  | 'duplicate_tool_result'
  | 'server_tool_use_without_result'

export type ToolResultPairingIssue = {
  kind: ToolResultPairingIssueKind
  toolUseId: string
  assistantIndex?: number
  assistantMessageId?: string
  userIndex?: number
  duplicateOfAssistantIndex?: number
  duplicateOfAssistantMessageId?: string
}

export type ToolResultPairingValidationResult = {
  valid: boolean
  context: ToolResultPairingValidationContext
  issues: ToolResultPairingIssue[]
}

export type ToolPairSafeMessageRangeOptions = {
  projectionName: string
  querySource?: string
  allowPendingToolUse?: boolean
  minStart?: number
  maxEnd?: number
  maxExtraMessages?: number
}

export type ToolPairSafeMessageRangeDiagnostics = {
  projectionName: string
  querySource?: string
  messageCountBefore: number
  messageCountAfter: number
  requestedRange: { start: number; end: number }
  adjustedRange: { start: number; end: number }
  issueKinds: ToolResultPairingIssueKind[]
  requestedStartedWithToolResult: boolean
  adjusted: boolean
}

export type ToolPairSafeMessageRangeResult<T extends Message> = {
  messages: T[]
  start: number
  end: number
  diagnostics: ToolPairSafeMessageRangeDiagnostics
}

function getToolUseId(block: unknown): string | null {
  if (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_use' &&
    'id' in block &&
    typeof block.id === 'string'
  ) {
    return block.id
  }
  return null
}

function getToolResultId(block: unknown): string | null {
  if (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_result' &&
    'tool_use_id' in block &&
    typeof block.tool_use_id === 'string'
  ) {
    return block.tool_use_id
  }
  return null
}

function getServerToolUseId(block: unknown): string | null {
  if (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block.type === 'server_tool_use' || block.type === 'mcp_tool_use') &&
    'id' in block &&
    typeof block.id === 'string'
  ) {
    return block.id
  }
  return null
}

function getToolUseIdReference(block: unknown): string | null {
  if (
    typeof block === 'object' &&
    block !== null &&
    'tool_use_id' in block &&
    typeof block.tool_use_id === 'string'
  ) {
    return block.tool_use_id
  }
  return null
}

function getToolResultIdsFromUserMessage(message: UserMessage): string[] {
  if (!Array.isArray(message.message.content)) {
    return []
  }
  return message.message.content
    .map(block => getToolResultId(block))
    .filter((id): id is string => id !== null)
}

function isUserOrAssistantMessage(
  message: Message,
): message is UserMessage | AssistantMessage {
  return message.type === 'user' || message.type === 'assistant'
}

function getToolUseIdsFromAssistantMessage(message: Message): string[] {
  if (message.type !== 'assistant') {
    return []
  }
  return message.message.content
    .map(block => getToolUseId(block))
    .filter((id): id is string => id !== null)
}

function getToolResultIdsFromMessage(message: Message): string[] {
  if (message.type !== 'user') {
    return []
  }
  const content = message.message.content
  if (!Array.isArray(content)) {
    return []
  }
  return content
    .map(block => getToolResultId(block))
    .filter((id): id is string => id !== null)
}

function collectToolUseIdsInRange(
  messages: Message[],
  start: number,
  end: number,
): Set<string> {
  const ids = new Set<string>()
  for (let i = start; i < end; i++) {
    for (const id of getToolUseIdsFromAssistantMessage(messages[i]!)) {
      ids.add(id)
    }
  }
  return ids
}

function collectToolResultIdsInRange(
  messages: Message[],
  start: number,
  end: number,
): Set<string> {
  const ids = new Set<string>()
  for (let i = start; i < end; i++) {
    for (const id of getToolResultIdsFromMessage(messages[i]!)) {
      ids.add(id)
    }
  }
  return ids
}

function clampRangeIndex(index: number, min: number, max: number): number {
  if (!Number.isFinite(index)) return min
  return Math.max(min, Math.min(max, Math.trunc(index)))
}

function findToolUseMessageIndex(
  messages: Message[],
  toolUseId: string,
  fromInclusive: number,
  toExclusive: number,
): number {
  for (let i = toExclusive - 1; i >= fromInclusive; i--) {
    if (getToolUseIdsFromAssistantMessage(messages[i]!).includes(toolUseId)) {
      return i
    }
  }
  return -1
}

function findToolResultMessageIndex(
  messages: Message[],
  toolUseId: string,
  fromInclusive: number,
  toExclusive: number,
): number {
  for (let i = fromInclusive; i < toExclusive; i++) {
    if (getToolResultIdsFromMessage(messages[i]!).includes(toolUseId)) {
      return i
    }
  }
  return -1
}

function findEarliestAssistantWithSameMessageId(
  messages: Message[],
  messageId: string,
  fromInclusive: number,
  toExclusive: number,
): number {
  let result = -1
  for (let i = fromInclusive; i < toExclusive; i++) {
    const message = messages[i]!
    if (message.type === 'assistant' && message.message.id === messageId) {
      result = i
      break
    }
  }
  return result
}

function findLatestAssistantWithSameMessageId(
  messages: Message[],
  messageId: string,
  fromInclusive: number,
  toExclusive: number,
): number {
  let result = -1
  for (let i = fromInclusive; i < toExclusive; i++) {
    const message = messages[i]!
    if (message.type === 'assistant' && message.message.id === messageId) {
      result = i
    }
  }
  return result
}

function getPairingIssueKinds(messages: Message[]): ToolResultPairingIssueKind[] {
  const pairable = messages.filter(isUserOrAssistantMessage)
  if (pairable.length === 0) return []
  const validation = validateToolResultPairing(pairable)
  return [...new Set(validation.issues.map(issue => issue.kind))]
}

function messageHasToolResult(message: Message | undefined): boolean {
  return message ? getToolResultIdsFromMessage(message).length > 0 : false
}

/**
 * Selects a contiguous message range without cutting through tool_use/tool_result
 * pairs. Projection producers should call this before slicing history for
 * summary, compaction, or forked-query contexts.
 */
export function selectToolPairSafeMessageRange<T extends Message>(
  messages: readonly T[],
  requestedStart: number,
  requestedEnd: number,
  options: ToolPairSafeMessageRangeOptions,
): ToolPairSafeMessageRangeResult<T> {
  const messageList = [...messages]
  const minStart = clampRangeIndex(options.minStart ?? 0, 0, messageList.length)
  const maxEnd = clampRangeIndex(
    options.maxEnd ?? messageList.length,
    minStart,
    messageList.length,
  )
  const clampedStart = clampRangeIndex(requestedStart, minStart, maxEnd)
  const clampedEnd = clampRangeIndex(requestedEnd, clampedStart, maxEnd)
  const maxExtraMessages =
    options.maxExtraMessages === undefined
      ? messageList.length
      : Math.max(0, Math.trunc(options.maxExtraMessages))
  let expansionMinStart = Math.max(minStart, clampedStart - maxExtraMessages)
  let expansionMaxEnd = Math.min(maxEnd, clampedEnd + maxExtraMessages)

  let start = clampedStart
  let end = clampedEnd
  const requestedMessages = messageList.slice(clampedStart, clampedEnd)
  const issueKinds = getPairingIssueKinds(requestedMessages)
  const requestedStartedWithToolResult = messageHasToolResult(
    messageList[clampedStart],
  )

  for (let guard = 0; guard < messageList.length * 2 + 2; guard++) {
    let changed = false

    for (let i = start; i < end; i++) {
      const message = messageList[i]!
      if (message.type !== 'assistant') continue
      const messageId = message.message.id
      if (!messageId) continue

      const earlier = findEarliestAssistantWithSameMessageId(
        messageList,
        messageId,
        0,
        start,
      )
      if (earlier !== -1) {
        if (earlier >= expansionMinStart) {
          start = earlier
        } else {
          const lastInRange = findLatestAssistantWithSameMessageId(
            messageList,
            messageId,
            start,
            end,
          )
          start = lastInRange + 1
          expansionMinStart = Math.max(expansionMinStart, start)
        }
        changed = true
        break
      }

      const later = findLatestAssistantWithSameMessageId(
        messageList,
        messageId,
        end,
        messageList.length,
      )
      if (later !== -1) {
        if (later < expansionMaxEnd) {
          end = later + 1
        } else {
          const firstInRange = findEarliestAssistantWithSameMessageId(
            messageList,
            messageId,
            start,
            end,
          )
          end = firstInRange
          expansionMaxEnd = Math.min(expansionMaxEnd, end)
        }
        changed = true
        break
      }
    }
    if (changed) continue

    const toolUseIds = collectToolUseIdsInRange(messageList, start, end)
    const toolResultIds = collectToolResultIdsInRange(messageList, start, end)

    for (let i = start; i < end; i++) {
      const resultIds = getToolResultIdsFromMessage(messageList[i]!)
      const orphanedResultId = resultIds.find(id => !toolUseIds.has(id))
      if (!orphanedResultId) continue

      const toolUseIndex = findToolUseMessageIndex(
        messageList,
        orphanedResultId,
        expansionMinStart,
        start,
      )
      if (toolUseIndex !== -1) {
        start = toolUseIndex
        changed = true
        break
      }

      start = i + 1
      expansionMinStart = Math.max(expansionMinStart, start)
      changed = true
      break
    }
    if (changed) continue

    for (let i = start; i < end; i++) {
      const toolUseIdsForMessage = getToolUseIdsFromAssistantMessage(
        messageList[i]!,
      )
      const missingToolUseId = toolUseIdsForMessage.find(
        id => !toolResultIds.has(id),
      )
      if (!missingToolUseId) continue

      const toolResultIndex = findToolResultMessageIndex(
        messageList,
        missingToolUseId,
        end,
        expansionMaxEnd,
      )
      if (toolResultIndex !== -1) {
        end = toolResultIndex + 1
        changed = true
        break
      }

      const hasResultOutsideRange =
        findToolResultMessageIndex(
          messageList,
          missingToolUseId,
          0,
          messageList.length,
        ) !== -1
      if (options.allowPendingToolUse && !hasResultOutsideRange) continue

      end = i
      expansionMaxEnd = Math.min(expansionMaxEnd, end)
      changed = true
      break
    }
    if (!changed) break
  }

  const selectedMessages = messageList.slice(start, end)
  const diagnostics: ToolPairSafeMessageRangeDiagnostics = {
    projectionName: options.projectionName,
    querySource: options.querySource,
    messageCountBefore: clampedEnd - clampedStart,
    messageCountAfter: selectedMessages.length,
    requestedRange: { start: clampedStart, end: clampedEnd },
    adjustedRange: { start, end },
    issueKinds,
    requestedStartedWithToolResult,
    adjusted: start !== clampedStart || end !== clampedEnd,
  }

  if (diagnostics.adjusted || issueKinds.length > 0) {
    logForDebugging(
      `[messageProjection] tool-pair-safe range projection=${options.projectionName} ` +
        `querySource=${options.querySource ?? 'unknown'} ` +
        `before=${diagnostics.messageCountBefore} after=${diagnostics.messageCountAfter} ` +
        `requested=${clampedStart}:${clampedEnd} adjusted=${start}:${end} ` +
        `issueKinds=${issueKinds.join(',') || 'none'} ` +
        `requestedStartedWithToolResult=${requestedStartedWithToolResult}`,
    )
  }

  return {
    messages: selectedMessages as T[],
    start,
    end,
    diagnostics,
  }
}

export function validateToolResultPairing(
  messages: (UserMessage | AssistantMessage)[],
  context: ToolResultPairingValidationContext = {},
): ToolResultPairingValidationResult {
  const issues: ToolResultPairingIssue[] = []
  const seenToolUses = new Map<
    string,
    { assistantIndex: number; assistantMessageId: string }
  >()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!

    if (msg.type === 'user') {
      if (messages[i - 1]?.type === 'assistant') {
        continue
      }
      for (const toolUseId of getToolResultIdsFromUserMessage(msg)) {
        issues.push({
          kind: 'orphaned_tool_result',
          toolUseId,
          userIndex: i,
        })
      }
      continue
    }

    const uniqueToolUseIds = new Set<string>()
    const serverResultIds = new Set<string>()
    for (const block of msg.message.content) {
      const toolUseIdReference = getToolUseIdReference(block)
      if (toolUseIdReference !== null) {
        serverResultIds.add(toolUseIdReference)
      }
    }

    for (const block of msg.message.content) {
      const toolUseId = getToolUseId(block)
      if (toolUseId !== null) {
        const firstSeen = seenToolUses.get(toolUseId)
        if (firstSeen) {
          issues.push({
            kind: 'duplicate_tool_use',
            toolUseId,
            assistantIndex: i,
            assistantMessageId: msg.message.id,
            duplicateOfAssistantIndex: firstSeen.assistantIndex,
            duplicateOfAssistantMessageId: firstSeen.assistantMessageId,
          })
        } else {
          seenToolUses.set(toolUseId, {
            assistantIndex: i,
            assistantMessageId: msg.message.id,
          })
        }

        uniqueToolUseIds.add(toolUseId)
      }

      const serverToolUseId = getServerToolUseId(block)
      if (
        serverToolUseId !== null &&
        !serverResultIds.has(serverToolUseId)
      ) {
        issues.push({
          kind: 'server_tool_use_without_result',
          toolUseId: serverToolUseId,
          assistantIndex: i,
          assistantMessageId: msg.message.id,
        })
      }
    }

    const nextMsg = messages[i + 1]
    const toolResultIds =
      nextMsg?.type === 'user' ? getToolResultIdsFromUserMessage(nextMsg) : []
    const toolResultIdSet = new Set(toolResultIds)
    const toolUseIdSet = new Set(uniqueToolUseIds)
    const seenToolResultIds = new Set<string>()

    for (const toolResultId of toolResultIds) {
      if (seenToolResultIds.has(toolResultId)) {
        issues.push({
          kind: 'duplicate_tool_result',
          toolUseId: toolResultId,
          assistantIndex: i,
          assistantMessageId: msg.message.id,
          userIndex: i + 1,
        })
      }
      seenToolResultIds.add(toolResultId)
    }

    for (const toolUseId of toolUseIdSet) {
      if (!toolResultIdSet.has(toolUseId)) {
        issues.push({
          kind: 'missing_tool_result',
          toolUseId,
          assistantIndex: i,
          assistantMessageId: msg.message.id,
        })
      }
    }

    for (const toolResultId of toolResultIdSet) {
      if (!toolUseIdSet.has(toolResultId)) {
        issues.push({
          kind: 'orphaned_tool_result',
          toolUseId: toolResultId,
          assistantIndex: i,
          assistantMessageId: msg.message.id,
          userIndex: i + 1,
        })
      }
    }
  }

  return {
    valid: issues.length === 0,
    context,
    issues,
  }
}

export function formatToolResultPairingIssue(
  issue: ToolResultPairingIssue,
): string {
  const parts = [`kind=${issue.kind}`, `tool_use_id=${issue.toolUseId}`]
  if (issue.assistantIndex !== undefined) {
    parts.push(`assistant_index=${issue.assistantIndex}`)
  }
  if (issue.assistantMessageId !== undefined) {
    parts.push(`assistant_message_id=${issue.assistantMessageId}`)
  }
  if (issue.userIndex !== undefined) {
    parts.push(`user_index=${issue.userIndex}`)
  }
  if (issue.duplicateOfAssistantIndex !== undefined) {
    parts.push(`duplicate_of_assistant_index=${issue.duplicateOfAssistantIndex}`)
  }
  if (issue.duplicateOfAssistantMessageId !== undefined) {
    parts.push(
      `duplicate_of_assistant_message_id=${issue.duplicateOfAssistantMessageId}`,
    )
  }
  return parts.join(',')
}

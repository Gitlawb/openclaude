import type {
  BetaMessage,
  BetaContentBlock,
  BetaUsage,
  BetaToolUseBlock,
  BetaMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { Attachment } from '../utils/attachments.js'
import type { APIError } from '@anthropic-ai/sdk'
import type {
  HookEvent,
  SDKAssistantMessageError,
} from '../entrypoints/agentSdkTypes.js'
import type { PermissionMode } from './permissions.js'

export type SystemMessageLevel = 'info' | 'warning' | 'error' | 'suggestion'
export type PartialCompactDirection = 'from' | 'up_to'

export type StopHookInfo = {
  command: string
  promptText?: string
  durationMs?: number
}

export type MessageOrigin =
  | { kind: 'task-notification' }
  | { kind: 'coordinator' }
  | { kind: 'channel'; server: string }
  | { kind: 'human' }

export type CompactMetadata = {
  trigger: 'manual' | 'auto'
  preTokens: number
  preservedSegment?: {
    headUuid: UUID | string
    anchorUuid: UUID | string
    tailUuid: UUID | string
  }
  preCompactDiscoveredTools?: string[]
  userContext?: string
  messagesSummarized?: number
}

export type BaseMessage = {
  uuid: UUID
  timestamp: string
}

export type AssistantMessage = BaseMessage & {
  type: 'assistant'
  message: BetaMessage & {
    content: BetaContentBlock[]
    usage: BetaUsage
    context_management?: unknown
  }
  requestId?: string
  apiError?:
    | 'prompt_too_long'
    | 'rate_limit_error'
    | 'api_error'
    | 'max_output_tokens'
    | string
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage?: boolean
  isMeta?: true
  isVirtual?: true
  advisorModel?: string
}

export type UserMessage = BaseMessage & {
  type: 'user'
  message: {
    role: 'user'
    content: string | ContentBlockParam[]
  }
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  sourceToolUseID?: string
  permissionMode?: PermissionMode
  origin?: MessageOrigin
  planContent?: string
}

export type ProgressMessage<P = import('./tools.js').ToolProgressData> = BaseMessage & {
  type: 'progress'
  data: P
  toolUseID: string
  parentToolUseID: string
}

export type AttachmentMessage<T extends Attachment = Attachment> = BaseMessage & {
  type: 'attachment'
  attachment: T
}

export type HookResultMessage = AttachmentMessage

export type SystemInformationalMessage = BaseMessage & {
  type: 'system'
  subtype: 'informational'
  content: string
  level: SystemMessageLevel
  toolUseID?: string
  preventContinuation?: boolean
  isMeta?: boolean
}

export type SystemPermissionRetryMessage = BaseMessage & {
  type: 'system'
  subtype: 'permission_retry'
  content: string
  level: SystemMessageLevel
  commands: string[]
  isMeta?: boolean
}

export type SystemBridgeStatusMessage = BaseMessage & {
  type: 'system'
  subtype: 'bridge_status'
  content: string
  level: SystemMessageLevel
  url: string
  upgradeNudge?: string
  isMeta?: boolean
}

export type SystemScheduledTaskFireMessage = BaseMessage & {
  type: 'system'
  subtype: 'scheduled_task_fire'
  content: string
  level: SystemMessageLevel
  isMeta?: boolean
}

export type SystemStopHookSummaryMessage = BaseMessage & {
  type: 'system'
  subtype: 'stop_hook_summary'
  content: string
  level: SystemMessageLevel
  hookCount: number
  hookInfos: StopHookInfo[]
  hookErrors: string[]
  preventedContinuation: boolean
  stopReason?: string
  hasOutput: boolean
  hookLabel?: string
  totalDurationMs?: number
  toolUseID?: string
}

export type SystemTurnDurationMessage = BaseMessage & {
  type: 'system'
  subtype: 'turn_duration'
  durationMs: number
  budgetTokens?: number
  budgetLimit?: number
  budgetNudges?: number
  messageCount?: number
  isMeta?: boolean
}

export type SystemAwaySummaryMessage = BaseMessage & {
  type: 'system'
  subtype: 'away_summary'
  content: string
  level?: SystemMessageLevel
  isMeta?: boolean
}

export type SystemMemorySavedMessage = BaseMessage & {
  type: 'system'
  subtype: 'memory_saved'
  content?: string
  level?: SystemMessageLevel
  writtenPaths: string[]
  isMeta?: boolean
}

export type SystemAgentsKilledMessage = BaseMessage & {
  type: 'system'
  subtype: 'agents_killed'
  content?: string
  level?: SystemMessageLevel
  isMeta?: boolean
}

export type SystemApiMetricsMessage = BaseMessage & {
  type: 'system'
  subtype: 'api_metrics'
  content?: string
  level?: SystemMessageLevel
  ttftMs?: number
  otps?: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
  isMeta?: boolean
}

export type SystemLocalCommandMessage = BaseMessage & {
  type: 'system'
  subtype: 'local_command'
  content: string
  level: SystemMessageLevel
  toolUseID?: string
  isMeta?: boolean
}

export type SystemThinkingMessage = BaseMessage & {
  type: 'system'
  subtype: 'thinking'
  content: string
  level: SystemMessageLevel
}

export type SystemAPIErrorMessage = BaseMessage & {
  type: 'system'
  subtype: 'api_error'
  content?: string
  level: SystemMessageLevel
  error: APIError
  retryInMs: number
  retryAttempt: number
  maxRetries: number
  cause?: Error
}

export type SystemCompactBoundaryMessage = BaseMessage & {
  type: 'system'
  subtype: 'compact_boundary'
  content: string
  level: SystemMessageLevel
  compactMetadata: CompactMetadata
  isMeta?: boolean
  logicalParentUuid?: UUID
}

export type SystemMicrocompactBoundaryMessage = BaseMessage & {
  type: 'system'
  subtype: 'microcompact_boundary'
  content: string
  level: SystemMessageLevel
  isMeta?: boolean
  microcompactMetadata: {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
  }
}

export type SystemFileSnapshotMessage = BaseMessage & {
  type: 'system'
  subtype: 'file_snapshot'
  content: string
  level: SystemMessageLevel
  isMeta?: boolean
  snapshotFiles: Array<{
    key: string
    path: string
    content: string
  }>
}

export type SystemMessage =
  | SystemInformationalMessage
  | SystemPermissionRetryMessage
  | SystemBridgeStatusMessage
  | SystemScheduledTaskFireMessage
  | SystemStopHookSummaryMessage
  | SystemTurnDurationMessage
  | SystemAwaySummaryMessage
  | SystemMemorySavedMessage
  | SystemAgentsKilledMessage
  | SystemApiMetricsMessage
  | SystemLocalCommandMessage
  | SystemThinkingMessage
  | SystemAPIErrorMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemFileSnapshotMessage

export type NormalizedAssistantMessage<T extends BetaContentBlock = BetaContentBlock> = AssistantMessage & {
  message: AssistantMessage['message'] & { content: [T] }
}

export type NormalizedUserMessage = UserMessage & {
  message: {
    role: 'user'
    content: Array<
      | { type: 'text'; text: string }
      | ToolResultBlockParam
      | ContentBlockParam
    >
  }
}

export type GroupedToolUseMessage = BaseMessage & {
  type: 'grouped_tool_use'
  messages: Array<NormalizedAssistantMessage | NormalizedUserMessage>
}

export type CollapsedReadSearchGroup = BaseMessage & {
  type: 'collapsed_read_search'
  messages: Array<NormalizedAssistantMessage | NormalizedUserMessage | AttachmentMessage>
  searchCount: number
  readCount: number
  listCount: number
  replCount: number
  memorySearchCount?: number
  memoryReadCount?: number
  memoryWriteCount?: number
  mcpCallCount?: number
  bashCount?: number
  gitOpBashCount?: number
  readFilePaths?: string[]
  searchArgs?: string[]
  latestDisplayHint?: string
  hookInfos?: StopHookInfo[]
  hookCount?: number
  hookTotalMs?: number
  relevantMemories?: string[]
}

export type TombstoneMessage = {
  type: 'tombstone'
  message: Message
}

export type ToolUseSummaryMessage = BaseMessage & {
  type: 'tool_use_summary'
  summary: string
  precedingToolUseIds: string[]
}

export type RequestStartEvent = {
  type: 'stream_request_start'
  requestId?: string
  ttftMs?: number
}

export type StreamEvent = {
  type: 'stream_event'
  event: BetaMessageStreamEvent
  ttftMs?: number
}

export type Message =
  | AssistantMessage
  | UserMessage
  | ProgressMessage
  | AttachmentMessage
  | SystemMessage

export type NormalizedMessage =
  | NormalizedAssistantMessage
  | NormalizedUserMessage
  | ProgressMessage
  | AttachmentMessage
  | SystemMessage

export type RenderableMessage =
  | NormalizedUserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup

export type CollapsibleMessage =
  | NormalizedAssistantMessage
  | NormalizedUserMessage
  | AttachmentMessage
  | SystemStopHookSummaryMessage

import type { APIError } from '@anthropic-ai/sdk'
import type {
  ContentBlock,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'

export type MessageOrigin = {
  kind: string
  [key: string]: unknown
}

export type CompactMetadata = {
  trigger?: string
  preTokens?: number
  preservedSegment?: {
    headUuid?: string
    anchorUuid?: string
    tailUuid?: string
  }
  [key: string]: unknown
}

export type PartialCompactDirection = 'from' | 'to' | 'around' | 'up_to'

export type SystemMessageLevel =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'debug'

export type StopHookInfo = {
  command?: string
  durationMs?: number
  promptText?: string
  hookName?: string
  event?: string
  summary?: string
  [key: string]: unknown
}

export type RequestStartEvent = {
  type: 'request_start'
  uuid: UUID | string
  timestamp: string
  requestId?: string
  model?: string
  [key: string]: unknown
}

type BaseMessage = {
  uuid: UUID | string
  timestamp: string
  requestId?: string
  sessionId?: string
  isMeta?: boolean
  isVirtual?: boolean
  isVisibleInTranscriptOnly?: boolean
  origin?: MessageOrigin
  [key: string]: unknown
}

type UserMessageContent = {
  content: string | ContentBlockParam[]
}

type AssistantMessageContent<TBlock = ContentBlock> = {
  id?: string
  usage?: Record<string, unknown>
  content: TBlock[]
}

export type UserMessage = BaseMessage & {
  type: 'user'
  message: UserMessageContent
  sourceToolUseID?: string
  toolUseResult?: unknown
  imagePasteIds?: Array<string | number>
  isCompactSummary?: boolean
  compactMetadata?: CompactMetadata
}

export type NormalizedUserMessage = UserMessage

export type AssistantMessage<TBlock = ContentBlock> = BaseMessage & {
  type: 'assistant'
  message: AssistantMessageContent<TBlock>
  advisorModel?: string
  error?: unknown
}

export type NormalizedAssistantMessage<TBlock = ContentBlock> =
  AssistantMessage<TBlock>

export type AttachmentMessage<
  TAttachment = Record<string, unknown>,
> = BaseMessage & {
  type: 'attachment'
  attachment: TAttachment
}

export type ProgressMessage<TProgress = unknown> = BaseMessage & {
  type: 'progress'
  data: TProgress
  toolUseID?: string
  parentUuid?: string
}

export type SystemMessage = BaseMessage & {
  type: 'system'
  subtype: string
  level?: SystemMessageLevel
  content?: string
  message?: {
    content: string | ContentBlockParam[]
  }
  compactMetadata?: CompactMetadata
  error?: APIError
  cause?: Error
  retryInMs?: number
  retryAttempt?: number
  maxRetries?: number
  hookInfos?: StopHookInfo[]
  snapshotFiles?: Array<{
    path: string
    content?: string
    label?: string
    [key: string]: unknown
  }>
}

export type SystemAPIErrorMessage = SystemMessage & {
  subtype: 'api_error'
  level: 'error'
  error: APIError
  retryInMs: number
  retryAttempt: number
  maxRetries: number
}

export type SystemInformationalMessage = SystemMessage & {
  subtype: 'informational'
}

export type SystemBridgeStatusMessage = SystemMessage & {
  subtype: 'bridge_status'
}

export type SystemScheduledTaskFireMessage = SystemMessage & {
  subtype: 'scheduled_task_fire'
}

export type SystemStopHookSummaryMessage = SystemMessage & {
  subtype: 'stop_hook_summary'
  hookInfos: StopHookInfo[]
}

export type SystemTurnDurationMessage = SystemMessage & {
  subtype: 'turn_duration'
}

export type SystemAwaySummaryMessage = SystemMessage & {
  subtype: 'away_summary'
}

export type SystemMemorySavedMessage = SystemMessage & {
  subtype: 'memory_saved'
  writtenPaths?: string[]
  teamCount?: number
}

export type SystemAgentsKilledMessage = SystemMessage & {
  subtype: 'agents_killed'
}

export type SystemMicrocompactBoundaryMessage = SystemMessage & {
  subtype: 'microcompact_boundary'
}

export type SystemPermissionRetryMessage = SystemMessage & {
  subtype: 'permission_retry'
}

export type SystemCompactBoundaryMessage = SystemMessage & {
  subtype: 'compact_boundary'
  compactMetadata: CompactMetadata
}

export type SystemLocalCommandMessage = SystemMessage & {
  subtype: 'local_command'
  content: string
}

export type SystemApiMetricsMessage = SystemMessage & {
  subtype: 'api_metrics'
}

export type SystemFileSnapshotMessage = SystemMessage & {
  subtype: 'file_snapshot'
  snapshotFiles: Array<{
    path: string
    content?: string
    label?: string
    [key: string]: unknown
  }>
}

export type SystemThinkingMessage = SystemMessage & {
  subtype: 'thinking'
}

export type StreamEvent = BaseMessage & {
  type: 'stream_event'
  event?: string
}

export type ToolUseSummaryMessage = {
  type: 'tool_use_summary'
  summary: string
  precedingToolUseIds: string[]
  uuid: UUID | string
  timestamp: string
}

export type TombstoneMessage = BaseMessage & {
  type: 'tombstone'
  reason?: string
}

export type GroupedToolUseMessage = BaseMessage & {
  type: 'grouped_tool_use'
  toolName: string
  messageId?: string
  messages: Array<
    NormalizedAssistantMessage | NormalizedUserMessage | AttachmentMessage
  >
  results: NormalizedUserMessage[]
  displayMessage?: NormalizedAssistantMessage | NormalizedUserMessage
}

export type CollapsibleMessage =
  | NormalizedAssistantMessage
  | NormalizedUserMessage
  | AttachmentMessage
  | SystemStopHookSummaryMessage

export type CollapsedReadSearchGroup = BaseMessage & {
  type: 'collapsed_read_search'
  messages: CollapsibleMessage[]
  displayMessage: CollapsibleMessage
  searchCount: number
  readCount: number
  listCount: number
  replCount: number
  memorySearchCount: number
  memoryReadCount: number
  memoryWriteCount: number
  readFilePaths: string[]
  searchArgs?: string[]
  latestDisplayHint?: string
  teamMemorySearchCount?: number
  teamMemoryReadCount?: number
  teamMemoryWriteCount?: number
  mcpCallCount?: number
  mcpServerNames?: string[]
  bashCount?: number
  gitOpBashCount?: number
  commits?: Array<{
    sha: string
    kind: 'committed' | 'amended' | 'cherry-picked'
  }>
  pushes?: Array<{
    branch: string
  }>
  branches?: Array<{
    ref: string
    action: 'merged' | 'rebased'
  }>
  prs?: Array<{
    number: number
    url?: string
    action: 'created' | 'edited' | 'merged' | 'commented' | 'closed' | 'ready'
  }>
  hookInfos?: StopHookInfo[]
  hookCount?: number
  hookTotalMs?: number
  relevantMemories?: Array<{
    path: string
    content: string
    mtimeMs?: number
  }>
}

export type HookResultMessage = AttachmentMessage

export type NormalizedMessage =
  | NormalizedAssistantMessage
  | NormalizedUserMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage

export type RenderableMessage =
  | NormalizedMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup
  | ToolUseSummaryMessage
  | TombstoneMessage

export type Message =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage
  | RequestStartEvent
  | ToolUseSummaryMessage
  | TombstoneMessage

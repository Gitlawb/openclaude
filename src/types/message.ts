import type {
  BetaContentBlock,
  BetaMessage
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { AgentId } from './ids.js'
import type { PermissionMode } from './permissions.js'

// Message origin tracking
export type MessageOrigin =
  | 'keyboard'
  | 'paste'
  | 'drop'
  | 'hook'
  | 'slash_command'
  | 'todo'
  | 'agent'
  | 'mcp'
  | 'context_menu'
  | 'resumed_session'

// Base message interface
export interface BaseMessage {
  uuid: UUID
  timestamp: string
}

// Assistant message (from Claude)
export interface AssistantMessage extends BaseMessage {
  type: 'assistant'
  message: BetaMessage
  requestId?: string
  error?: unknown
  errorDetails?: string
  isApiErrorMessage?: boolean
  apiError?: {
    type: string
    status?: number
    message?: string
  }
  isVirtual?: true
  isMeta?: true
  advisorModel?: string
  parent_tool_use_id?: string | null
}

// User message (from the user)
export interface UserMessage extends BaseMessage {
  type: 'user'
  message: {
    role: 'user'
    content: string | ContentBlockParam[]
  }
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  permissionMode?: PermissionMode
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
  origin?: MessageOrigin
}

// Normalized message types (single content block per message)
export interface NormalizedAssistantMessage extends AssistantMessage {
  message: BetaMessage & {
    content: [BetaContentBlock]
  }
}

export interface NormalizedUserMessage extends UserMessage {
  message: {
    role: 'user'
    content: [ContentBlockParam]
  }
}

export type NormalizedMessage = NormalizedAssistantMessage | NormalizedUserMessage

// Compact direction for summarization
export interface PartialCompactDirection {
  behavior: 'compact'
  description: string
}

// Attachment message (hook attachments, etc.)
export interface AttachmentMessage extends BaseMessage {
  type: 'attachment'
  attachment: {
    type: string
    toolUseID: string
    hookEvent?: string
    [key: string]: unknown
  }
}

// Progress message for tool execution
export interface ProgressMessage<P = unknown> extends BaseMessage {
  type: 'progress'
  toolUseID: string
  parentToolUseID: string
  data: P
}

// System message types
export type SystemMessageLevel = 'info' | 'warning' | 'error'

export interface SystemMessage extends BaseMessage {
  type: 'system'
  systemMessageType: string
  level: SystemMessageLevel
  message: string
}

export interface SystemAPIErrorMessage extends SystemMessage {
  systemMessageType: 'api_error'
  error: {
    type: string
    status?: number
    message?: string
  }
}

export interface SystemAgentsKilledMessage extends SystemMessage {
  systemMessageType: 'agents_killed'
  agentIds: AgentId[]
}

export interface SystemAwaySummaryMessage extends SystemMessage {
  systemMessageType: 'away_summary'
  summary: string
}

export interface SystemBridgeStatusMessage extends SystemMessage {
  systemMessageType: 'bridge_status'
  status: 'connected' | 'disconnected'
}

export interface SystemCompactBoundaryMessage extends SystemMessage {
  systemMessageType: 'compact_boundary'
  messagesSummarized: number
}

export interface SystemMicrocompactBoundaryMessage extends SystemMessage {
  systemMessageType: 'microcompact_boundary'
}

export interface SystemInformationalMessage extends SystemMessage {
  systemMessageType: 'informational'
}

export interface SystemLocalCommandMessage extends SystemMessage {
  systemMessageType: 'local_command'
  command: string
}

export interface SystemMemorySavedMessage extends SystemMessage {
  systemMessageType: 'memory_saved'
  memoryId: string
}

export interface SystemPermissionRetryMessage extends SystemMessage {
  systemMessageType: 'permission_retry'
  toolUseID: string
}

export interface SystemScheduledTaskFireMessage extends SystemMessage {
  systemMessageType: 'scheduled_task_fire'
  taskId: string
}

export interface SystemStopHookSummaryMessage extends SystemMessage {
  systemMessageType: 'stop_hook_summary'
  hookResults: unknown[]
}

export interface SystemTurnDurationMessage extends SystemMessage {
  systemMessageType: 'turn_duration'
  durationMs: number
}

export interface SystemApiMetricsMessage extends SystemMessage {
  systemMessageType: 'api_metrics'
  metrics: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
}

// Tombstone message (for deleted/compacted content)
export interface TombstoneMessage extends BaseMessage {
  type: 'tombstone'
  originalType: string
  originalUUID: UUID
  reason: string
}

// Tool use summary message
export interface ToolUseSummaryMessage extends BaseMessage {
  type: 'tool_use_summary'
  toolUseID: string
  toolName: string
  summary: string
}

// Union type of all system message variants
export type SystemMessageVariant =
  | SystemAPIErrorMessage
  | SystemAgentsKilledMessage
  | SystemAwaySummaryMessage
  | SystemBridgeStatusMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemInformationalMessage
  | SystemLocalCommandMessage
  | SystemMemorySavedMessage
  | SystemPermissionRetryMessage
  | SystemScheduledTaskFireMessage
  | SystemStopHookSummaryMessage
  | SystemTurnDurationMessage
  | SystemApiMetricsMessage

// Main Message union type
export type Message =
  | AssistantMessage
  | UserMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessageVariant
  | TombstoneMessage
  | ToolUseSummaryMessage

// Hook-related types
export interface StopHookInfo {
  toolUseID: string
  toolName: string
  stopReason: string
}

export interface RequestStartEvent {
  type: 'request_start'
  requestId: string
  timestamp: string
}

export interface StreamEvent {
  type: 'stream_event'
  event: unknown
  timestamp: string
}

// Hook result message type (used internally)
export interface HookResultMessage {
  type: 'hook_result'
  hookEvent: string
  hookName: string
  outcome: 'success' | 'blocking' | 'non_blocking_error' | 'cancelled'
  message?: Message
}

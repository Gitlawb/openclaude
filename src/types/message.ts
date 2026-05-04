/**
 * Stub — message type definitions not included in source snapshot.
 *
 * The upstream Anthropic source defines a rich Message discriminated union
 * with structured Content blocks, role tags, tool_use payloads, and so on.
 * That file is not mirrored to this open snapshot. This stub exists so
 * `tsc --noEmit` can resolve `import { Message, ... } from 'src/types/message'`
 * across the ~21 callers without fixing every transitive type the call
 * sites use.
 *
 * Once the real definitions are restored upstream-side or reconstructed
 * from runtime usage, replace these `any` aliases with proper types and
 * delete this comment. See issue #473 for the typecheck-foundation effort.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Message = any
export type AssistantMessage = any
export type UserMessage = any
export type SystemMessage = any
export type SystemAPIErrorMessage = any
export type AttachmentMessage<T = any> = any
export type ProgressMessage<T = any> = any
export type HookResultMessage = any
export type NormalizedUserMessage = any
export type NormalizedAssistantMessage<T = any> = any
export type RenderableMessage = any
export type CollapsedReadSearchGroup = any
export type GroupedToolUseMessage = any
export type CollapsibleMessage = any
export type PartialCompactDirection = any
export type RequestStartEvent = any
export type StreamEvent = any
export type ToolUseSummaryMessage = any
export type TombstoneMessage = any
export type StopHookInfo = any
export type MessageOrigin = any
export type CompactMetadata = any
export type SystemStopHookSummaryMessage = any
export type SystemBridgeStatusMessage = any
export type SystemTurnDurationMessage = any
export type SystemThinkingMessage = any
export type SystemMemorySavedMessage = any
export type SystemInformationalMessage = any
export type SystemLocalCommandMessage = any
export type SystemCompactBoundaryMessage = any
export type SystemMicrocompactBoundaryMessage = any
export type SystemPermissionRetryMessage = any
export type SystemScheduledTaskFireMessage = any
export type SystemAwaySummaryMessage = any
export type SystemAgentsKilledMessage = any
export type SystemFileSnapshotMessage = any

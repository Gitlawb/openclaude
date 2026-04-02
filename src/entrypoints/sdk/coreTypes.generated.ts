import { z } from 'zod/v4'
import {
  AccountInfoSchema,
  AgentDefinitionSchema,
  AgentInfoSchema,
  ApiKeySourceSchema,
  AsyncHookJSONOutputSchema,
  ConfigChangeHookInputSchema,
  CwdChangedHookInputSchema,
  ElicitationHookInputSchema,
  ElicitationResultHookInputSchema,
  ExitReasonSchema,
  FastModeStateSchema,
  FileChangedHookInputSchema,
  HookEventSchema,
  HookInputSchema,
  HookJSONOutputSchema,
  InstructionsLoadedHookInputSchema,
  McpServerConfigForProcessTransportSchema,
  McpServerStatusSchema,
  ModelInfoSchema,
  ModelUsageSchema,
  NotificationHookInputSchema,
  PermissionDeniedHookInputSchema,
  PermissionModeSchema,
  PermissionRequestHookInputSchema,
  PermissionResultSchema,
  PermissionUpdateSchema,
  PostCompactHookInputSchema,
  PostToolUseFailureHookInputSchema,
  PostToolUseHookInputSchema,
  PreCompactHookInputSchema,
  PreToolUseHookInputSchema,
  PromptRequestSchema,
  PromptResponseSchema,
  RewindFilesResultSchema,
  SDKAssistantMessageErrorSchema,
  SDKAssistantMessageSchema,
  SDKCompactBoundaryMessageSchema,
  SDKElicitationCompleteMessageSchema,
  SDKMessageSchema,
  SDKPartialAssistantMessageSchema,
  SDKPermissionDenialSchema,
  SDKPostTurnSummaryMessageSchema,
  SDKRateLimitInfoSchema,
  SDKResultErrorSchema,
  SDKResultMessageSchema,
  SDKResultSuccessSchema,
  SDKSessionInfoSchema,
  SDKStatusMessageSchema,
  SDKStatusSchema,
  SDKStreamlinedTextMessageSchema,
  SDKStreamlinedToolUseSummaryMessageSchema,
  SDKSystemMessageSchema,
  SDKTaskProgressMessageSchema,
  SDKToolProgressMessageSchema,
  SDKToolUseSummaryMessageSchema,
  SDKUserMessageReplaySchema,
  SDKUserMessageSchema,
  SessionEndHookInputSchema,
  SessionStartHookInputSchema,
  SetupHookInputSchema,
  SlashCommandSchema,
  StopFailureHookInputSchema,
  StopHookInputSchema,
  SubagentStartHookInputSchema,
  SubagentStopHookInputSchema,
  SyncHookJSONOutputSchema,
  TaskCompletedHookInputSchema,
  TaskCreatedHookInputSchema,
  TeammateIdleHookInputSchema,
  UserPromptSubmitHookInputSchema,
} from './coreSchemas.js'

export type ModelUsage = z.infer<ReturnType<typeof ModelUsageSchema>>
export type ApiKeySource = z.infer<ReturnType<typeof ApiKeySourceSchema>>
export type McpServerConfigForProcessTransport = z.infer<
  ReturnType<typeof McpServerConfigForProcessTransportSchema>
>
export type McpServerStatus = z.infer<ReturnType<typeof McpServerStatusSchema>>
export type PermissionUpdate = z.infer<ReturnType<typeof PermissionUpdateSchema>>
export type PermissionResult = z.infer<ReturnType<typeof PermissionResultSchema>>
export type PermissionMode = z.infer<ReturnType<typeof PermissionModeSchema>>
export type HookEvent = z.infer<ReturnType<typeof HookEventSchema>>
export type HookInput = z.infer<ReturnType<typeof HookInputSchema>>
export type PreToolUseHookInput = z.infer<
  ReturnType<typeof PreToolUseHookInputSchema>
>
export type PostToolUseHookInput = z.infer<
  ReturnType<typeof PostToolUseHookInputSchema>
>
export type PostToolUseFailureHookInput = z.infer<
  ReturnType<typeof PostToolUseFailureHookInputSchema>
>
export type PermissionDeniedHookInput = z.infer<
  ReturnType<typeof PermissionDeniedHookInputSchema>
>
export type NotificationHookInput = z.infer<
  ReturnType<typeof NotificationHookInputSchema>
>
export type UserPromptSubmitHookInput = z.infer<
  ReturnType<typeof UserPromptSubmitHookInputSchema>
>
export type SessionStartHookInput = z.infer<
  ReturnType<typeof SessionStartHookInputSchema>
>
export type SessionEndHookInput = z.infer<
  ReturnType<typeof SessionEndHookInputSchema>
>
export type StopHookInput = z.infer<ReturnType<typeof StopHookInputSchema>>
export type StopFailureHookInput = z.infer<
  ReturnType<typeof StopFailureHookInputSchema>
>
export type SubagentStartHookInput = z.infer<
  ReturnType<typeof SubagentStartHookInputSchema>
>
export type SubagentStopHookInput = z.infer<
  ReturnType<typeof SubagentStopHookInputSchema>
>
export type PreCompactHookInput = z.infer<
  ReturnType<typeof PreCompactHookInputSchema>
>
export type PostCompactHookInput = z.infer<
  ReturnType<typeof PostCompactHookInputSchema>
>
export type PermissionRequestHookInput = z.infer<
  ReturnType<typeof PermissionRequestHookInputSchema>
>
export type SetupHookInput = z.infer<ReturnType<typeof SetupHookInputSchema>>
export type TeammateIdleHookInput = z.infer<
  ReturnType<typeof TeammateIdleHookInputSchema>
>
export type TaskCreatedHookInput = z.infer<
  ReturnType<typeof TaskCreatedHookInputSchema>
>
export type TaskCompletedHookInput = z.infer<
  ReturnType<typeof TaskCompletedHookInputSchema>
>
export type ElicitationHookInput = z.infer<
  ReturnType<typeof ElicitationHookInputSchema>
>
export type ElicitationResultHookInput = z.infer<
  ReturnType<typeof ElicitationResultHookInputSchema>
>
export type ConfigChangeHookInput = z.infer<
  ReturnType<typeof ConfigChangeHookInputSchema>
>
export type InstructionsLoadedHookInput = z.infer<
  ReturnType<typeof InstructionsLoadedHookInputSchema>
>
export type CwdChangedHookInput = z.infer<
  ReturnType<typeof CwdChangedHookInputSchema>
>
export type FileChangedHookInput = z.infer<
  ReturnType<typeof FileChangedHookInputSchema>
>
export type AsyncHookJSONOutput = z.infer<
  ReturnType<typeof AsyncHookJSONOutputSchema>
>
export type SyncHookJSONOutput = z.infer<
  ReturnType<typeof SyncHookJSONOutputSchema>
>
export type HookJSONOutput = z.infer<ReturnType<typeof HookJSONOutputSchema>>
export type PromptRequest = z.infer<ReturnType<typeof PromptRequestSchema>>
export type PromptResponse = z.infer<ReturnType<typeof PromptResponseSchema>>
export type ModelInfo = z.infer<ReturnType<typeof ModelInfoSchema>>
export type AccountInfo = z.infer<ReturnType<typeof AccountInfoSchema>>
export type SlashCommand = z.infer<ReturnType<typeof SlashCommandSchema>>
export type AgentInfo = z.infer<ReturnType<typeof AgentInfoSchema>>
export type AgentDefinition = z.infer<ReturnType<typeof AgentDefinitionSchema>>
export type RewindFilesResult = z.infer<ReturnType<typeof RewindFilesResultSchema>>
export type SDKAssistantMessageError = z.infer<
  ReturnType<typeof SDKAssistantMessageErrorSchema>
>
export type SDKStatus = z.infer<ReturnType<typeof SDKStatusSchema>>
export type SDKUserMessage = z.infer<ReturnType<typeof SDKUserMessageSchema>>
export type SDKUserMessageReplay = z.infer<
  ReturnType<typeof SDKUserMessageReplaySchema>
>
export type SDKRateLimitInfo = z.infer<
  ReturnType<typeof SDKRateLimitInfoSchema>
>
export type SDKAssistantMessage = z.infer<
  ReturnType<typeof SDKAssistantMessageSchema>
>
export type SDKPermissionDenial = z.infer<
  ReturnType<typeof SDKPermissionDenialSchema>
>
export type SDKResultSuccess = z.infer<
  ReturnType<typeof SDKResultSuccessSchema>
>
export type SDKResultError = z.infer<ReturnType<typeof SDKResultErrorSchema>>
export type SDKResultMessage = z.infer<ReturnType<typeof SDKResultMessageSchema>>
export type SDKSystemMessage = z.infer<ReturnType<typeof SDKSystemMessageSchema>>
export type SDKCompactBoundaryMessage = z.infer<
  ReturnType<typeof SDKCompactBoundaryMessageSchema>
>
export type SDKStatusMessage = z.infer<
  ReturnType<typeof SDKStatusMessageSchema>
>
export type SDKPartialAssistantMessage = z.infer<
  ReturnType<typeof SDKPartialAssistantMessageSchema>
>
export type SDKStreamlinedTextMessage = z.infer<
  ReturnType<typeof SDKStreamlinedTextMessageSchema>
>
export type SDKStreamlinedToolUseSummaryMessage = z.infer<
  ReturnType<typeof SDKStreamlinedToolUseSummaryMessageSchema>
>
export type SDKPostTurnSummaryMessage = z.infer<
  ReturnType<typeof SDKPostTurnSummaryMessageSchema>
>
export type SDKToolProgressMessage = z.infer<
  ReturnType<typeof SDKToolProgressMessageSchema>
>
export type SDKTaskProgressMessage = z.infer<
  ReturnType<typeof SDKTaskProgressMessageSchema>
>
export type SDKToolUseSummaryMessage = z.infer<
  ReturnType<typeof SDKToolUseSummaryMessageSchema>
>
export type SDKElicitationCompleteMessage = z.infer<
  ReturnType<typeof SDKElicitationCompleteMessageSchema>
>
export type SDKSessionInfo = z.infer<ReturnType<typeof SDKSessionInfoSchema>>
export type SDKMessage = z.infer<ReturnType<typeof SDKMessageSchema>>
export type FastModeState = z.infer<ReturnType<typeof FastModeStateSchema>>
export type ExitReason = z.infer<ReturnType<typeof ExitReasonSchema>>

import type { z } from 'zod/v4'
import {
  AccountInfoSchema,
  AgentDefinitionSchema,
  AgentInfoSchema,
  AgentMcpServerSpecSchema,
  ApiKeySourceSchema,
  AsyncHookJSONOutputSchema,
  BaseHookInputSchema,
  BaseOutputFormatSchema,
  ConfigChangeHookInputSchema,
  ConfigScopeSchema,
  CwdChangedHookInputSchema,
  CwdChangedHookSpecificOutputSchema,
  ElicitationHookInputSchema,
  ElicitationHookSpecificOutputSchema,
  ElicitationResultHookInputSchema,
  ElicitationResultHookSpecificOutputSchema,
  ExitReasonSchema,
  FastModeStateSchema,
  FileChangedHookInputSchema,
  FileChangedHookSpecificOutputSchema,
  HookEventSchema,
  HookInputSchema,
  HookJSONOutputSchema,
  InstructionsLoadedHookInputSchema,
  JsonSchemaOutputFormatSchema,
  McpClaudeAIProxyServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSdkServerConfigSchema,
  McpSSEServerConfigSchema,
  McpServerConfigForProcessTransportSchema,
  McpServerStatusConfigSchema,
  McpServerStatusSchema,
  McpSetServersResultSchema,
  McpStdioServerConfigSchema,
  ModelInfoSchema,
  ModelUsageSchema,
  NotificationHookInputSchema,
  NotificationHookSpecificOutputSchema,
  OutputFormatSchema,
  OutputFormatTypeSchema,
  PermissionBehaviorSchema,
  PermissionDecisionClassificationSchema,
  PermissionDeniedHookInputSchema,
  PermissionDeniedHookSpecificOutputSchema,
  PermissionModeSchema,
  PermissionRequestHookInputSchema,
  PermissionRequestHookSpecificOutputSchema,
  PermissionResultSchema,
  PermissionRuleValueSchema,
  PermissionUpdateDestinationSchema,
  PermissionUpdateSchema,
  PostCompactHookInputSchema,
  PostToolUseFailureHookInputSchema,
  PostToolUseFailureHookSpecificOutputSchema,
  PostToolUseHookInputSchema,
  PostToolUseHookSpecificOutputSchema,
  PreCompactHookInputSchema,
  PreToolUseHookInputSchema,
  PreToolUseHookSpecificOutputSchema,
  PromptRequestOptionSchema,
  PromptRequestSchema,
  PromptResponseSchema,
  RewindFilesResultSchema,
  SDKAPIRetryMessageSchema,
  SDKAssistantMessageErrorSchema,
  SDKAssistantMessageSchema,
  SDKAuthStatusMessageSchema,
  SDKCompactBoundaryMessageSchema,
  SDKElicitationCompleteMessageSchema,
  SDKFilesPersistedEventSchema,
  SDKHookProgressMessageSchema,
  SDKHookResponseMessageSchema,
  SDKHookStartedMessageSchema,
  SDKLocalCommandOutputMessageSchema,
  SDKMessageSchema,
  SDKPartialAssistantMessageSchema,
  SDKPermissionDenialSchema,
  SDKPostTurnSummaryMessageSchema,
  SDKPromptSuggestionMessageSchema,
  SDKRateLimitEventSchema,
  SDKRateLimitInfoSchema,
  SDKResultErrorSchema,
  SDKResultMessageSchema,
  SDKResultSuccessSchema,
  SDKSessionInfoSchema,
  SDKSessionStateChangedMessageSchema,
  SDKStatusMessageSchema,
  SDKStatusSchema,
  SDKStreamlinedTextMessageSchema,
  SDKStreamlinedToolUseSummaryMessageSchema,
  SDKSystemMessageSchema,
  SDKTaskNotificationMessageSchema,
  SDKTaskProgressMessageSchema,
  SDKTaskStartedMessageSchema,
  SDKToolProgressMessageSchema,
  SDKToolUseSummaryMessageSchema,
  SDKUserMessageReplaySchema,
  SDKUserMessageSchema,
  SdkBetaSchema,
  SdkPluginConfigSchema,
  SessionEndHookInputSchema,
  SessionStartHookInputSchema,
  SessionStartHookSpecificOutputSchema,
  SetupHookInputSchema,
  SetupHookSpecificOutputSchema,
  SlashCommandSchema,
  StopFailureHookInputSchema,
  StopHookInputSchema,
  SubagentStartHookInputSchema,
  SubagentStartHookSpecificOutputSchema,
  SubagentStopHookInputSchema,
  SyncHookJSONOutputSchema,
  TaskCompletedHookInputSchema,
  TaskCreatedHookInputSchema,
  TeammateIdleHookInputSchema,
  ThinkingAdaptiveSchema,
  ThinkingConfigSchema,
  ThinkingDisabledSchema,
  ThinkingEnabledSchema,
  UserPromptSubmitHookInputSchema,
  UserPromptSubmitHookSpecificOutputSchema,
  WorktreeCreateHookInputSchema,
  WorktreeCreateHookSpecificOutputSchema,
  WorktreeRemoveHookInputSchema,
} from './coreSchemas.js'

// Generated from coreSchemas.ts. Keep in sync with schema exports.
export type ModelUsage = z.infer<ReturnType<typeof ModelUsageSchema>>
export type OutputFormatType = z.infer<ReturnType<typeof OutputFormatTypeSchema>>
export type BaseOutputFormat = z.infer<ReturnType<typeof BaseOutputFormatSchema>>
export type JsonSchemaOutputFormat = z.infer<ReturnType<typeof JsonSchemaOutputFormatSchema>>
export type OutputFormat = z.infer<ReturnType<typeof OutputFormatSchema>>
export type ApiKeySource = z.infer<ReturnType<typeof ApiKeySourceSchema>>
export type ConfigScope = z.infer<ReturnType<typeof ConfigScopeSchema>>
export type SdkBeta = z.infer<ReturnType<typeof SdkBetaSchema>>
export type ThinkingAdaptive = z.infer<ReturnType<typeof ThinkingAdaptiveSchema>>
export type ThinkingEnabled = z.infer<ReturnType<typeof ThinkingEnabledSchema>>
export type ThinkingDisabled = z.infer<ReturnType<typeof ThinkingDisabledSchema>>
export type ThinkingConfig = z.infer<ReturnType<typeof ThinkingConfigSchema>>
export type McpStdioServerConfig = z.infer<ReturnType<typeof McpStdioServerConfigSchema>>
export type McpSSEServerConfig = z.infer<ReturnType<typeof McpSSEServerConfigSchema>>
export type McpHttpServerConfig = z.infer<ReturnType<typeof McpHttpServerConfigSchema>>
export type McpSdkServerConfig = z.infer<ReturnType<typeof McpSdkServerConfigSchema>>
export type McpServerConfigForProcessTransport = z.infer<ReturnType<typeof McpServerConfigForProcessTransportSchema>>
export type McpClaudeAIProxyServerConfig = z.infer<ReturnType<typeof McpClaudeAIProxyServerConfigSchema>>
export type McpServerStatusConfig = z.infer<ReturnType<typeof McpServerStatusConfigSchema>>
export type McpServerStatus = z.infer<ReturnType<typeof McpServerStatusSchema>>
export type McpSetServersResult = z.infer<ReturnType<typeof McpSetServersResultSchema>>
export type PermissionUpdateDestination = z.infer<ReturnType<typeof PermissionUpdateDestinationSchema>>
export type PermissionBehavior = z.infer<ReturnType<typeof PermissionBehaviorSchema>>
export type PermissionRuleValue = z.infer<ReturnType<typeof PermissionRuleValueSchema>>
export type PermissionUpdate = z.infer<ReturnType<typeof PermissionUpdateSchema>>
export type PermissionDecisionClassification = z.infer<ReturnType<typeof PermissionDecisionClassificationSchema>>
export type PermissionResult = z.infer<ReturnType<typeof PermissionResultSchema>>
export type PermissionMode = z.infer<ReturnType<typeof PermissionModeSchema>>
export type HookEvent = z.infer<ReturnType<typeof HookEventSchema>>
export type BaseHookInput = z.infer<ReturnType<typeof BaseHookInputSchema>>
export type PreToolUseHookInput = z.infer<ReturnType<typeof PreToolUseHookInputSchema>>
export type PermissionRequestHookInput = z.infer<ReturnType<typeof PermissionRequestHookInputSchema>>
export type PostToolUseHookInput = z.infer<ReturnType<typeof PostToolUseHookInputSchema>>
export type PostToolUseFailureHookInput = z.infer<ReturnType<typeof PostToolUseFailureHookInputSchema>>
export type PermissionDeniedHookInput = z.infer<ReturnType<typeof PermissionDeniedHookInputSchema>>
export type NotificationHookInput = z.infer<ReturnType<typeof NotificationHookInputSchema>>
export type UserPromptSubmitHookInput = z.infer<ReturnType<typeof UserPromptSubmitHookInputSchema>>
export type SessionStartHookInput = z.infer<ReturnType<typeof SessionStartHookInputSchema>>
export type SetupHookInput = z.infer<ReturnType<typeof SetupHookInputSchema>>
export type StopHookInput = z.infer<ReturnType<typeof StopHookInputSchema>>
export type StopFailureHookInput = z.infer<ReturnType<typeof StopFailureHookInputSchema>>
export type SubagentStartHookInput = z.infer<ReturnType<typeof SubagentStartHookInputSchema>>
export type SubagentStopHookInput = z.infer<ReturnType<typeof SubagentStopHookInputSchema>>
export type PreCompactHookInput = z.infer<ReturnType<typeof PreCompactHookInputSchema>>
export type PostCompactHookInput = z.infer<ReturnType<typeof PostCompactHookInputSchema>>
export type TeammateIdleHookInput = z.infer<ReturnType<typeof TeammateIdleHookInputSchema>>
export type TaskCreatedHookInput = z.infer<ReturnType<typeof TaskCreatedHookInputSchema>>
export type TaskCompletedHookInput = z.infer<ReturnType<typeof TaskCompletedHookInputSchema>>
export type ElicitationHookInput = z.infer<ReturnType<typeof ElicitationHookInputSchema>>
export type ElicitationResultHookInput = z.infer<ReturnType<typeof ElicitationResultHookInputSchema>>
export type ConfigChangeHookInput = z.infer<ReturnType<typeof ConfigChangeHookInputSchema>>
export type InstructionsLoadedHookInput = z.infer<ReturnType<typeof InstructionsLoadedHookInputSchema>>
export type WorktreeCreateHookInput = z.infer<ReturnType<typeof WorktreeCreateHookInputSchema>>
export type WorktreeRemoveHookInput = z.infer<ReturnType<typeof WorktreeRemoveHookInputSchema>>
export type CwdChangedHookInput = z.infer<ReturnType<typeof CwdChangedHookInputSchema>>
export type FileChangedHookInput = z.infer<ReturnType<typeof FileChangedHookInputSchema>>
export type ExitReason = z.infer<ReturnType<typeof ExitReasonSchema>>
export type SessionEndHookInput = z.infer<ReturnType<typeof SessionEndHookInputSchema>>
export type AsyncHookJSONOutput = z.infer<ReturnType<typeof AsyncHookJSONOutputSchema>>
export type PreToolUseHookSpecificOutput = z.infer<ReturnType<typeof PreToolUseHookSpecificOutputSchema>>
export type UserPromptSubmitHookSpecificOutput = z.infer<ReturnType<typeof UserPromptSubmitHookSpecificOutputSchema>>
export type SessionStartHookSpecificOutput = z.infer<ReturnType<typeof SessionStartHookSpecificOutputSchema>>
export type SetupHookSpecificOutput = z.infer<ReturnType<typeof SetupHookSpecificOutputSchema>>
export type SubagentStartHookSpecificOutput = z.infer<ReturnType<typeof SubagentStartHookSpecificOutputSchema>>
export type PostToolUseHookSpecificOutput = z.infer<ReturnType<typeof PostToolUseHookSpecificOutputSchema>>
export type PostToolUseFailureHookSpecificOutput = z.infer<ReturnType<typeof PostToolUseFailureHookSpecificOutputSchema>>
export type PermissionDeniedHookSpecificOutput = z.infer<ReturnType<typeof PermissionDeniedHookSpecificOutputSchema>>
export type NotificationHookSpecificOutput = z.infer<ReturnType<typeof NotificationHookSpecificOutputSchema>>
export type PermissionRequestHookSpecificOutput = z.infer<ReturnType<typeof PermissionRequestHookSpecificOutputSchema>>
export type CwdChangedHookSpecificOutput = z.infer<ReturnType<typeof CwdChangedHookSpecificOutputSchema>>
export type FileChangedHookSpecificOutput = z.infer<ReturnType<typeof FileChangedHookSpecificOutputSchema>>
export type SyncHookJSONOutput = z.infer<ReturnType<typeof SyncHookJSONOutputSchema>>
export type ElicitationHookSpecificOutput = z.infer<ReturnType<typeof ElicitationHookSpecificOutputSchema>>
export type ElicitationResultHookSpecificOutput = z.infer<ReturnType<typeof ElicitationResultHookSpecificOutputSchema>>
export type WorktreeCreateHookSpecificOutput = z.infer<ReturnType<typeof WorktreeCreateHookSpecificOutputSchema>>
export type HookJSONOutput = z.infer<ReturnType<typeof HookJSONOutputSchema>>
export type HookInput = z.infer<ReturnType<typeof HookInputSchema>>
export type PromptRequestOption = z.infer<ReturnType<typeof PromptRequestOptionSchema>>
export type PromptRequest = z.infer<ReturnType<typeof PromptRequestSchema>>
export type PromptResponse = z.infer<ReturnType<typeof PromptResponseSchema>>
export type SlashCommand = z.infer<ReturnType<typeof SlashCommandSchema>>
export type AgentInfo = z.infer<ReturnType<typeof AgentInfoSchema>>
export type ModelInfo = z.infer<ReturnType<typeof ModelInfoSchema>>
export type AccountInfo = z.infer<ReturnType<typeof AccountInfoSchema>>
export type AgentMcpServerSpec = z.infer<ReturnType<typeof AgentMcpServerSpecSchema>>
export type AgentDefinition = z.infer<ReturnType<typeof AgentDefinitionSchema>>
export type SdkPluginConfig = z.infer<ReturnType<typeof SdkPluginConfigSchema>>
export type RewindFilesResult = z.infer<ReturnType<typeof RewindFilesResultSchema>>
export type SDKAssistantMessageError = z.infer<ReturnType<typeof SDKAssistantMessageErrorSchema>>
export type SDKStatus = z.infer<ReturnType<typeof SDKStatusSchema>>
export type SDKUserMessage = z.infer<ReturnType<typeof SDKUserMessageSchema>>
export type SDKUserMessageReplay = z.infer<ReturnType<typeof SDKUserMessageReplaySchema>>
export type SDKRateLimitInfo = z.infer<ReturnType<typeof SDKRateLimitInfoSchema>>
export type SDKAssistantMessage = z.infer<ReturnType<typeof SDKAssistantMessageSchema>>
export type SDKRateLimitEvent = z.infer<ReturnType<typeof SDKRateLimitEventSchema>>
export type SDKStreamlinedTextMessage = z.infer<ReturnType<typeof SDKStreamlinedTextMessageSchema>>
export type SDKStreamlinedToolUseSummaryMessage = z.infer<ReturnType<typeof SDKStreamlinedToolUseSummaryMessageSchema>>
export type SDKPermissionDenial = z.infer<ReturnType<typeof SDKPermissionDenialSchema>>
export type SDKResultSuccess = z.infer<ReturnType<typeof SDKResultSuccessSchema>>
export type SDKResultError = z.infer<ReturnType<typeof SDKResultErrorSchema>>
export type SDKResultMessage = z.infer<ReturnType<typeof SDKResultMessageSchema>>
export type SDKSystemMessage = z.infer<ReturnType<typeof SDKSystemMessageSchema>>
export type SDKPartialAssistantMessage = z.infer<ReturnType<typeof SDKPartialAssistantMessageSchema>>
export type SDKCompactBoundaryMessage = z.infer<ReturnType<typeof SDKCompactBoundaryMessageSchema>>
export type SDKStatusMessage = z.infer<ReturnType<typeof SDKStatusMessageSchema>>
export type SDKPostTurnSummaryMessage = z.infer<ReturnType<typeof SDKPostTurnSummaryMessageSchema>>
export type SDKAPIRetryMessage = z.infer<ReturnType<typeof SDKAPIRetryMessageSchema>>
export type SDKLocalCommandOutputMessage = z.infer<ReturnType<typeof SDKLocalCommandOutputMessageSchema>>
export type SDKHookStartedMessage = z.infer<ReturnType<typeof SDKHookStartedMessageSchema>>
export type SDKHookProgressMessage = z.infer<ReturnType<typeof SDKHookProgressMessageSchema>>
export type SDKHookResponseMessage = z.infer<ReturnType<typeof SDKHookResponseMessageSchema>>
export type SDKToolProgressMessage = z.infer<ReturnType<typeof SDKToolProgressMessageSchema>>
export type SDKAuthStatusMessage = z.infer<ReturnType<typeof SDKAuthStatusMessageSchema>>
export type SDKFilesPersistedEvent = z.infer<ReturnType<typeof SDKFilesPersistedEventSchema>>
export type SDKTaskNotificationMessage = z.infer<ReturnType<typeof SDKTaskNotificationMessageSchema>>
export type SDKTaskStartedMessage = z.infer<ReturnType<typeof SDKTaskStartedMessageSchema>>
export type SDKSessionStateChangedMessage = z.infer<ReturnType<typeof SDKSessionStateChangedMessageSchema>>
export type SDKTaskProgressMessage = z.infer<ReturnType<typeof SDKTaskProgressMessageSchema>>
export type SDKToolUseSummaryMessage = z.infer<ReturnType<typeof SDKToolUseSummaryMessageSchema>>
export type SDKElicitationCompleteMessage = z.infer<ReturnType<typeof SDKElicitationCompleteMessageSchema>>
export type SDKPromptSuggestionMessage = z.infer<ReturnType<typeof SDKPromptSuggestionMessageSchema>>
export type SDKSessionInfo = z.infer<ReturnType<typeof SDKSessionInfoSchema>>
export type SDKMessage = z.infer<ReturnType<typeof SDKMessageSchema>>
export type FastModeState = z.infer<ReturnType<typeof FastModeStateSchema>>

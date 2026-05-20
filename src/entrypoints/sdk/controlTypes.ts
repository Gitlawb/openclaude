import type { z } from 'zod/v4'
import type { SDKPartialAssistantMessage } from './coreTypes.generated.js'
import {
  ControlErrorResponseSchema,
  ControlResponseSchema,
  SDKControlCancelRequestSchema,
  SDKControlElicitationRequestSchema,
  SDKControlElicitationResponseSchema,
  SDKControlGetContextUsageRequestSchema,
  SDKControlGetContextUsageResponseSchema,
  SDKControlGetSettingsRequestSchema,
  SDKControlGetSettingsResponseSchema,
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlInterruptRequestSchema,
  SDKControlMcpMessageRequestSchema,
  SDKControlMcpReconnectRequestSchema,
  SDKControlMcpSetServersRequestSchema,
  SDKControlMcpSetServersResponseSchema,
  SDKControlMcpStatusRequestSchema,
  SDKControlMcpStatusResponseSchema,
  SDKControlMcpToggleRequestSchema,
  SDKControlPermissionRequestSchema,
  SDKControlReloadPluginsRequestSchema,
  SDKControlReloadPluginsResponseSchema,
  SDKControlRequestInnerSchema,
  SDKControlRequestSchema,
  SDKControlResponseSchema,
  SDKControlRewindFilesRequestSchema,
  SDKControlRewindFilesResponseSchema,
  SDKControlSeedReadStateRequestSchema,
  SDKControlSetMaxThinkingTokensRequestSchema,
  SDKControlSetModelRequestSchema,
  SDKControlSetPermissionModeRequestSchema,
  SDKControlStopTaskRequestSchema,
  SDKHookCallbackMatcherSchema,
  SDKHookCallbackRequestSchema,
  SDKKeepAliveMessageSchema,
  SDKUpdateEnvironmentVariablesMessageSchema,
  StdinMessageSchema,
  StdoutMessageSchema,
} from './controlSchemas.js'

// Generated from controlSchemas.ts. Keep in sync with schema exports.
export type SDKHookCallbackMatcher = z.infer<ReturnType<typeof SDKHookCallbackMatcherSchema>>
export type SDKControlInitializeRequest = z.infer<ReturnType<typeof SDKControlInitializeRequestSchema>>
export type SDKControlInitializeResponse = z.infer<ReturnType<typeof SDKControlInitializeResponseSchema>>
export type SDKControlInterruptRequest = z.infer<ReturnType<typeof SDKControlInterruptRequestSchema>>
export type SDKControlPermissionRequest = z.infer<ReturnType<typeof SDKControlPermissionRequestSchema>>
export type SDKControlSetPermissionModeRequest = z.infer<ReturnType<typeof SDKControlSetPermissionModeRequestSchema>>
export type SDKControlSetModelRequest = z.infer<ReturnType<typeof SDKControlSetModelRequestSchema>>
export type SDKControlSetMaxThinkingTokensRequest = z.infer<ReturnType<typeof SDKControlSetMaxThinkingTokensRequestSchema>>
export type SDKControlMcpStatusRequest = z.infer<ReturnType<typeof SDKControlMcpStatusRequestSchema>>
export type SDKControlMcpStatusResponse = z.infer<ReturnType<typeof SDKControlMcpStatusResponseSchema>>
export type SDKControlGetContextUsageRequest = z.infer<ReturnType<typeof SDKControlGetContextUsageRequestSchema>>
export type SDKControlGetContextUsageResponse = z.infer<ReturnType<typeof SDKControlGetContextUsageResponseSchema>>
export type SDKControlRewindFilesRequest = z.infer<ReturnType<typeof SDKControlRewindFilesRequestSchema>>
export type SDKControlRewindFilesResponse = z.infer<ReturnType<typeof SDKControlRewindFilesResponseSchema>>
export type SDKControlSeedReadStateRequest = z.infer<ReturnType<typeof SDKControlSeedReadStateRequestSchema>>
export type SDKHookCallbackRequest = z.infer<ReturnType<typeof SDKHookCallbackRequestSchema>>
export type SDKControlMcpMessageRequest = z.infer<ReturnType<typeof SDKControlMcpMessageRequestSchema>>
export type SDKControlMcpSetServersRequest = z.infer<ReturnType<typeof SDKControlMcpSetServersRequestSchema>>
export type SDKControlMcpSetServersResponse = z.infer<ReturnType<typeof SDKControlMcpSetServersResponseSchema>>
export type SDKControlReloadPluginsRequest = z.infer<ReturnType<typeof SDKControlReloadPluginsRequestSchema>>
export type SDKControlReloadPluginsResponse = z.infer<ReturnType<typeof SDKControlReloadPluginsResponseSchema>>
export type SDKControlMcpReconnectRequest = z.infer<ReturnType<typeof SDKControlMcpReconnectRequestSchema>>
export type SDKControlMcpToggleRequest = z.infer<ReturnType<typeof SDKControlMcpToggleRequestSchema>>
export type SDKControlStopTaskRequest = z.infer<ReturnType<typeof SDKControlStopTaskRequestSchema>>
export type SDKControlGetSettingsRequest = z.infer<ReturnType<typeof SDKControlGetSettingsRequestSchema>>
export type SDKControlGetSettingsResponse = z.infer<ReturnType<typeof SDKControlGetSettingsResponseSchema>>
export type SDKControlElicitationRequest = z.infer<ReturnType<typeof SDKControlElicitationRequestSchema>>
export type SDKControlElicitationResponse = z.infer<ReturnType<typeof SDKControlElicitationResponseSchema>>
export type SDKControlRequestInner = any
export type SDKControlRequest = any
export type ControlResponse = any
export type ControlErrorResponse = any
export type SDKControlResponse = any
export type SDKControlCancelRequest = any
export type SDKKeepAliveMessage = any
export type SDKUpdateEnvironmentVariablesMessage = any
export type StdoutMessage = any
export type StdinMessage = any
export type { SDKPartialAssistantMessage }

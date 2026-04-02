import { z } from 'zod/v4'
import {
  ControlErrorResponseSchema,
  ControlResponseSchema,
  SDKControlCancelRequestSchema,
  SDKControlElicitationResponseSchema,
  SDKControlGetSettingsResponseSchema,
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlMcpSetServersResponseSchema,
  SDKControlReloadPluginsResponseSchema,
  SDKControlRequestInnerSchema,
  SDKControlRequestSchema,
  SDKControlResponseSchema,
  SDKKeepAliveMessageSchema,
  StdinMessageSchema,
  StdoutMessageSchema,
} from './controlSchemas.js'
import { SDKPartialAssistantMessageSchema } from './coreSchemas.js'

export type SDKControlInitializeRequest = z.infer<
  ReturnType<typeof SDKControlInitializeRequestSchema>
>
export type SDKControlInitializeResponse = z.infer<
  ReturnType<typeof SDKControlInitializeResponseSchema>
>
export type SDKControlMcpSetServersResponse = z.infer<
  ReturnType<typeof SDKControlMcpSetServersResponseSchema>
>
export type SDKControlReloadPluginsResponse = z.infer<
  ReturnType<typeof SDKControlReloadPluginsResponseSchema>
>
export type SDKControlElicitationResponse = z.infer<
  ReturnType<typeof SDKControlElicitationResponseSchema>
>
export type SDKControlGetSettingsResponse = z.infer<
  ReturnType<typeof SDKControlGetSettingsResponseSchema>
>
export type SDKControlRequestInner = z.infer<
  ReturnType<typeof SDKControlRequestInnerSchema>
>
export type SDKControlRequest = z.infer<ReturnType<typeof SDKControlRequestSchema>>
export type ControlResponse = z.infer<ReturnType<typeof ControlResponseSchema>>
export type ControlErrorResponse = z.infer<
  ReturnType<typeof ControlErrorResponseSchema>
>
export type SDKControlResponse = z.infer<
  ReturnType<typeof SDKControlResponseSchema>
>
export type SDKControlCancelRequest = z.infer<
  ReturnType<typeof SDKControlCancelRequestSchema>
>
export type SDKKeepAliveMessage = z.infer<
  ReturnType<typeof SDKKeepAliveMessageSchema>
>
export type SDKPartialAssistantMessage = z.infer<
  ReturnType<typeof SDKPartialAssistantMessageSchema>
>
export type StdoutMessage = z.infer<ReturnType<typeof StdoutMessageSchema>>
export type StdinMessage = z.infer<ReturnType<typeof StdinMessageSchema>>

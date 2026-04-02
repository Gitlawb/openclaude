import { z } from 'zod/v4'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type {
  PermissionMode,
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from './coreTypes.js'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type AnyZodRawShape = z.ZodRawShape
export type InferShape<Schema extends AnyZodRawShape> = z.infer<
  z.ZodObject<Schema>
>

export type SdkMcpToolDefinition<Schema extends AnyZodRawShape> = {
  name: string
  description: string
  inputSchema: Schema
  handler: (
    args: InferShape<Schema>,
    extra: unknown,
  ) => Promise<CallToolResult>
  annotations?: ToolAnnotations
  searchHint?: string
  alwaysLoad?: boolean
}

export type McpSdkServerConfigWithInstance = {
  type: 'sdk'
  name: string
  instance: unknown
}

export type Options = {
  cwd?: string
  model?: string
  permissionMode?: PermissionMode
  maxThinkingTokens?: number | null
  additionalDirectories?: string[]
  env?: Record<string, string>
  stderr?: (data: string) => void
  executable?: string
  executableArgs?: string[]
  pathToClaudeCodeExecutable?: string
  fallbackCwd?: string
  continue?: boolean
  resume?: string
  maxTurns?: number
  disallowedTools?: string[]
  allowedTools?: string[]
  mcpServers?: Record<string, unknown>
  customSystemPrompt?: string
  appendSystemPrompt?: string
  permissionPromptToolName?: string
  canUseTool?: unknown
  hooks?: Record<string, unknown>
  outputFormat?: unknown
  settings?: Record<string, unknown>
}

export type InternalOptions = Options & {
  isInternal?: boolean
}

export type Query = AsyncIterable<SDKMessage>
export type InternalQuery = AsyncIterable<SDKMessage>

export type SDKSessionOptions = Options

export type SDKSession = {
  id?: string
  sendMessage?(message: string | SDKUserMessage): Query
  prompt?(message: string): Promise<SDKResultMessage>
}

export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
}

export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
}

export type GetSessionInfoOptions = {
  dir?: string
}

export type SessionMutationOptions = {
  dir?: string
}

export type ForkSessionOptions = {
  dir?: string
  upToMessageId?: string
  title?: string
}

export type ForkSessionResult = {
  sessionId: string
}

export type SessionMessage = SDKMessage

export type SDKSessionMetadata = SDKSessionInfo

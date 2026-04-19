// Type declarations for @gitlawb/openclaude SDK
// Generated from src/entrypoints/sdk.ts

// ============================================================================
// Error
// ============================================================================

export class AbortError extends Error {
  override readonly name: 'AbortError'
}

export class ClaudeError extends Error {
  constructor(message: string)
}

export class SDKAuthenticationError extends ClaudeError {
  constructor(message?: string)
}

export class SDKBillingError extends ClaudeError {
  constructor(message?: string)
}

export class SDKRateLimitError extends ClaudeError {
  constructor(
    message?: string,
    readonly resetsAt?: number,
    readonly rateLimitType?: string,
  )
}

export class SDKInvalidRequestError extends ClaudeError {
  constructor(message?: string)
}

export class SDKServerError extends ClaudeError {
  constructor(message?: string)
}

export class SDKMaxOutputTokensError extends ClaudeError {
  constructor(message?: string)
}

export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'

export function sdkErrorFromType(
  errorType: SDKAssistantMessageError,
  message?: string,
): ClaudeError

// ============================================================================
// Types
// ============================================================================

export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'oauth'

export type RewindFilesResult = {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

export type McpServerStatus = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  serverInfo?: { name: string; version: string }
  error?: string
  tools?: {
    name: string
    description?: string
    annotations?: {
      readOnly?: boolean
      destructive?: boolean
      openWorld?: boolean
    }
  }[]
}

export type PermissionResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: unknown[]
      toolUseID?: string
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
      toolUseID?: string
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
    }

export type SDKSessionInfo = {
  session_id: string
  summary: string
  last_modified: number
  file_size?: number
  custom_title?: string
  first_prompt?: string
  git_branch?: string
  cwd?: string
  tag?: string
  created_at?: number
}

export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeWorktrees?: boolean
}

export type GetSessionInfoOptions = {
  dir?: string
}

export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
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
  session_id: string
}

export type SessionMessage = {
  role: 'user' | 'assistant' | 'system'
  content: unknown
  timestamp?: string
  uuid?: string
  parent_uuid?: string | null
  [key: string]: unknown
}

export type SDKMessage = {
  type: string
  [key: string]: unknown
}

export type SDKUserMessage = {
  type: 'user'
  message: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  parent_tool_use_id?: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: 'now' | 'next' | 'later'
  timestamp?: string
  uuid?: string
  session_id?: string
}

export type SDKResultMessage = SDKMessage & {
  type: 'result'
  subtype: string
  is_error: boolean
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  result: string
  stop_reason: string | null
  session_id: string
  total_cost_usd: number
  uuid: string
}

// ============================================================================
// Query types
// ============================================================================

export type QueryPermissionMode =
  | 'default'
  | 'plan'
  | 'auto-accept'
  | 'bypass-permissions'

export type QueryOptions = {
  cwd: string
  additionalDirectories?: string[]
  model?: string
  sessionId?: string
  resume?: string
  permissionMode?: QueryPermissionMode
  abortController?: AbortController
  executable?: string
  allowDangerouslySkipPermissions?: boolean
  disallowedTools?: string[]
  hooks?: Record<string, unknown[]>
  mcpServers?: Record<string, unknown>
  settings?: {
    env?: Record<string, string>
    attribution?: { commit: string; pr: string }
  }
  canUseTool?: (
    name: string,
    input: unknown,
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>
  systemPrompt?:
    | { type: 'preset'; preset: string }
    | { type: 'custom'; content: string }
  settingSources?: string[]
  stderr?: (data: string) => void
}

export interface Query {
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: QueryPermissionMode): Promise<void>
  close(): void
  interrupt(): void
  respondToPermission(toolUseId: string, decision: PermissionResult): void
  rewindFiles(): RewindFilesResult
  supportedCommands(): string[]
  supportedModels(): string[]
  supportedAgents(): string[]
  mcpServerStatus(): McpServerStatus[]
  accountInfo(): Promise<{ apiKeySource: ApiKeySource; [key: string]: unknown }>
  setMaxThinkingTokens(tokens: number): void
}

// ============================================================================
// V2 API types
// ============================================================================

export type SDKSessionOptions = {
  cwd: string
  model?: string
  permissionMode?: QueryPermissionMode
  abortController?: AbortController
  canUseTool?: (
    name: string,
    input: unknown,
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>
}

export interface SDKSession {
  sessionId: string
  sendMessage(content: string): AsyncIterable<SDKMessage>
  getMessages(): SDKMessage[]
  interrupt(): void
}

// ============================================================================
// MCP tool types
// ============================================================================

export interface SdkMcpToolDefinition<Schema = any> {
  name: string
  description: string
  inputSchema: Schema
  handler: (args: any, extra: unknown) => Promise<any>
  annotations?: any
  searchHint?: string
  alwaysLoad?: boolean
}

// ============================================================================
// Session functions
// ============================================================================

export function listSessions(
  options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]>

export function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined>

export function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]>

export function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void>

export function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void>

export function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult>

export function deleteSession(
  sessionId: string,
  options?: SessionMutationOptions,
): Promise<void>

// ============================================================================
// Query functions
// ============================================================================

export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}): Query

export function queryAsync(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}): Promise<Query>

// ============================================================================
// V2 API functions
// ============================================================================

export function unstable_v2_createSession(options: SDKSessionOptions): SDKSession

export function unstable_v2_resumeSession(
  sessionId: string,
  options: SDKSessionOptions,
): SDKSession

export function unstable_v2_prompt(
  message: string,
  options: SDKSessionOptions,
): Promise<SDKResultMessage>

// ============================================================================
// MCP tool functions
// ============================================================================

export function tool<Schema = any>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: any, extra: unknown) => Promise<any>,
  extras?: {
    annotations?: any
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema>

export function createSdkMcpServer(options: {
  name: string
  version?: string
  tools?: SdkMcpToolDefinition[]
}): {
  name: string
  version: string | undefined
  tools: SdkMcpToolDefinition[]
}

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

export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'oauth' | 'none'

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
  scope?: string
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
  uuid?: string
  message?: unknown
  parent_tool_use_id?: string | null
  timestamp?: string
  session_id?: string
  [key: string]: unknown
}

export type SDKUserMessage = {
  type: 'user'
  message: Record<string, unknown> & { role: 'user'; content: string | Array<unknown> }
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: 'now' | 'next' | 'later'
  timestamp?: string
  uuid?: string
  session_id?: string
}

export type SDKResultMessage = SDKMessage & (
  | {
      type: 'result'
      subtype: 'success'
      is_error: boolean
      duration_ms: number
      duration_api_ms: number
      num_turns: number
      result: string
      stop_reason: string | null
      total_cost_usd: number
      usage: Record<string, number>
      modelUsage: Record<string, {
        inputTokens: number
        outputTokens: number
        cacheReadInputTokens: number
        cacheCreationInputTokens: number
        webSearchRequests: number
        costUSD: number
        contextWindow: number
        maxOutputTokens: number
      }>
      permission_denials: {
        tool_name: string
        tool_use_id: string
        tool_input: Record<string, unknown>
      }[]
      structured_output?: unknown
      fast_mode_state?: 'off' | 'cooldown' | 'on'
      uuid: string
      session_id: string
    }
  | {
      type: 'result'
      subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'
      is_error: boolean
      duration_ms: number
      duration_api_ms: number
      num_turns: number
      stop_reason: string | null
      total_cost_usd: number
      usage: Record<string, number>
      modelUsage: Record<string, {
        inputTokens: number
        outputTokens: number
        cacheReadInputTokens: number
        cacheCreationInputTokens: number
        webSearchRequests: number
        costUSD: number
        contextWindow: number
        maxOutputTokens: number
      }>
      permission_denials: {
        tool_name: string
        tool_use_id: string
        tool_input: Record<string, unknown>
      }[]
      errors: string[]
      fast_mode_state?: 'off' | 'cooldown' | 'on'
      uuid: string
      session_id: string
    }
)

// ============================================================================
// Query types
// ============================================================================

export type QueryPermissionMode =
  | 'default'
  | 'plan'
  | 'auto-accept'
  | 'bypass-permissions'
  | 'bypassPermissions'
  | 'acceptEdits'

export type QueryOptions = {
  cwd: string
  additionalDirectories?: string[]
  model?: string
  sessionId?: string
  /** Fork the session before resuming (requires sessionId). */
  fork?: boolean
  /** Alias for fork. When true, resumed session forks to a new session ID. */
  forkSession?: boolean
  /** Resume the most recent session for this cwd (no sessionId needed). */
  continue?: boolean
  resume?: string
  /** When resuming, resume messages up to and including this message UUID. */
  resumeSessionAt?: string
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
  /** Environment variables to apply during query execution. Overrides process.env. Takes precedence over settings.env. */
  env?: Record<string, string | undefined>
  /**
   * Callback invoked before each tool use. Return `{ behavior: 'allow' }` to
   * permit the call or `{ behavior: 'deny', message?: string }` to reject it.
   *
   * **Secure-by-default**: If neither `canUseTool` nor `onPermissionRequest`
   * is provided, ALL tool uses are denied. You MUST provide at least one of
   * these callbacks to allow tool execution.
   */
  canUseTool?: (
    name: string,
    input: unknown,
    options?: { toolUseID?: string },
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }>
  systemPrompt?:
    | string
    | { type: 'preset'; preset: string; append?: string }
    | { type: 'custom'; content: string }
  /** Agent definitions to register with the query engine. */
  agents?: Record<string, {
    description: string
    prompt: string
    tools?: string[]
    disallowedTools?: string[]
    model?: string
    maxTurns?: number
  }>
  settingSources?: string[]
  /** When true, yields stream_event messages for token-by-token streaming. */
  includePartialMessages?: boolean
  stderr?: (data: string) => void
}

export interface Query {
  readonly sessionId: string
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: QueryPermissionMode): Promise<void>
  close(): void
  interrupt(): void
  respondToPermission(toolUseId: string, decision: PermissionResult): void
  /** Check if file rewind is possible. */
  rewindFiles(): RewindFilesResult
  /** Actually perform the file rewind. Returns files changed and diff stats. */
  rewindFilesAsync(): Promise<RewindFilesResult>
  supportedCommands(): string[]
  supportedModels(): string[]
  supportedAgents(): string[]
  mcpServerStatus(): McpServerStatus[]
  accountInfo(): Promise<{ apiKeySource: ApiKeySource; [key: string]: unknown }>
  setMaxThinkingTokens(tokens: number): void
}

export type SDKPermissionTimeoutMessage = {
  type: 'permission_timeout'
  tool_name: string
  tool_use_id: string
  timed_out_after_ms: number
}

// ============================================================================
// V2 API types
// ============================================================================

export type SDKSessionOptions = {
  cwd: string
  model?: string
  permissionMode?: QueryPermissionMode
  abortController?: AbortController
  /**
   * Callback invoked before each tool use. Return `{ behavior: 'allow' }` to
   * permit the call or `{ behavior: 'deny', message?: string }` to reject it.
   *
   * **Secure-by-default**: If neither `canUseTool` nor `onPermissionRequest`
   * is provided, ALL tool uses are denied. You MUST provide at least one of
   * these callbacks to allow tool execution.
   */
  canUseTool?: (
    name: string,
    input: unknown,
    options?: { toolUseID?: string },
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }>
}

export interface SDKSession {
  sessionId: string
  sendMessage(content: string): AsyncIterable<SDKMessage>
  getMessages(): SDKMessage[]
  interrupt(): void
  /** Respond to a pending permission prompt. */
  respondToPermission(toolUseId: string, decision: PermissionResult): void
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
): Promise<SDKSession>

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

/**
 * MCP server transport configuration types.
 * Matches McpServerConfigForProcessTransport from coreTypes.generated.ts.
 */
export type SdkMcpStdioConfig = {
  type?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type SdkMcpSSEConfig = {
  type: "sse"
  url: string
  headers?: Record<string, string>
}

export type SdkMcpHttpConfig = {
  type: "http"
  url: string
  headers?: Record<string, string>
}

export type SdkMcpSdkConfig = {
  type: "sdk"
  name: string
}

export type SdkMcpServerConfig = SdkMcpStdioConfig | SdkMcpSSEConfig | SdkMcpHttpConfig | SdkMcpSdkConfig

/**
 * Scoped MCP server config with session scope.
 * Returned by createSdkMcpServer() for use with mcpServers option.
 */
export type SdkScopedMcpServerConfig = SdkMcpServerConfig & {
  scope: "session"
}

/**
 * Wraps an MCP server configuration for use with the SDK.
 * Adds the 'session' scope marker so the SDK knows this server
 * should be connected per-session (not globally).
 *
 * @param config - MCP server config (stdio, sse, http, or sdk type)
 * @returns Scoped config with scope: 'session' added
 *
 * @example
 * ```typescript
 * const server = createSdkMcpServer({
 *   type: 'stdio',
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 * })
 * const session = unstable_v2_createSession({
 *   cwd: '/my/project',
 *   mcpServers: { 'fs': server },
 * })
 * ```
 */
export function createSdkMcpServer(config: SdkMcpServerConfig): SdkScopedMcpServerConfig

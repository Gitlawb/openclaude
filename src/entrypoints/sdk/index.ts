/**
 * SDK entry point — session management functions and query().
 *
 * This file is the barrel module for the SDK. It re-exports everything from
 * the sub-modules and runs stub leak detection at module load time.
 *
 * The SDK is bundled as `dist/sdk.mjs` separately from the CLI.
 * It must NOT import React, Ink, or any CLI/TUI code.
 */

import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { QueryEngine } from '../../QueryEngine.js'
import { getTools } from '../../tools.js'
import { init } from '../init.js'

// ============================================================================
// Stub leak detection
// ============================================================================

/**
 * One-time check that detects TUI/CLI component stubs leaking into the SDK
 * runtime. The esbuild sdk-missing-stub plugin marks every stub with
 * `__stub: true`. We check core SDK modules that should NEVER be stubs.
 * If any resolved to a stub, it means a TUI dependency leaked through.
 */
function detectStubLeaks(): void {
  const criticalImports: Array<{ name: string; mod: Record<string, unknown> }> = [
    // QueryEngine is the core SDK engine — must never be a stub
    { name: 'QueryEngine', mod: QueryEngine as unknown as Record<string, unknown> },
    // These are imported by this file and must be real modules, not stubs
    { name: 'getTools', mod: getTools as unknown as Record<string, unknown> },
    { name: 'init', mod: init as unknown as Record<string, unknown> },
  ]

  for (const { name, mod } of criticalImports) {
    if ('__stub' in mod && mod.__stub === true) {
      throw new Error(
        `SDK init error: "${name}" resolved to a build stub at runtime. ` +
        `This means a TUI/CLI dependency leaked into the SDK bundle. ` +
        `Report this at https://github.com/Gitlawb/openclaude/issues`,
      )
    }
  }
}

// Run leak detection once at module load time.
detectStubLeaks()

// ============================================================================
// Re-exports from shared types
// ============================================================================

export type {
  SDKMessage,
  SDKUserMessage,
  SDKSessionInfo,
  ListSessionsOptions,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  SessionMutationOptions,
  ForkSessionOptions,
  ForkSessionResult,
  SessionMessage,
  SDKPermissionRequestMessage,
  SDKPermissionTimeoutMessage,
  SDKAgentLoadFailureMessage,
  QueryPermissionMode,
} from './shared.js'

// ============================================================================
// Re-exports from permissions
// ============================================================================

export type { PermissionResolveDecision } from './permissions.js'

// ============================================================================
// Re-exports from sessions
// ============================================================================

export {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  tagSession,
  deleteSession,
  forkSession,
} from './sessions.js'

// ============================================================================
// Re-exports from query
// ============================================================================

export type { QueryOptions } from './query.js'
export { query, queryAsync } from './query.js'
export type { Query } from './query.js'

// ============================================================================
// Re-exports from v2
// ============================================================================

export type {
  SDKSessionOptions,
  SDKResultMessage,
} from './v2.js'
export type { SDKSession } from './v2.js'
export type { SdkMcpToolDefinition } from './v2.js'
export {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt,
} from './v2.js'

// ============================================================================
// tool() — factory function for creating MCP tool definitions
// ============================================================================

/**
 * Create a tool definition that can be passed to `createSdkMcpServer()`.
 *
 * @param name - Tool name (must be unique within the server)
 * @param description - Human-readable description of what the tool does
 * @param inputSchema - Zod raw shape or JSON Schema describing the input
 * @param handler - Async function that handles tool invocations
 * @param extras - Optional annotations, search hint, and alwaysLoad flag
 *
 * @example
 * ```typescript
 * const myTool = tool(
 *   'read_file',
 *   'Read a file from disk',
 *   { path: z.string() },
 *   async (args) => ({
 *     content: [{ type: 'text', text: await fs.readFile(args.path, 'utf8') }],
 *   }),
 * )
 * ```
 */
export function tool<Schema = any>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: any, extra: unknown) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): import('./v2.js').SdkMcpToolDefinition<Schema> {
  return {
    name,
    description,
    inputSchema,
    handler,
    annotations: extras?.annotations,
    searchHint: extras?.searchHint,
    alwaysLoad: extras?.alwaysLoad,
  }
}

// ============================================================================
// Public MCP config types — mirror sdk.d.ts declarations
// ============================================================================

export type SdkMcpStdioConfig = {
  type?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type SdkMcpSSEConfig = {
  type: 'sse'
  url: string
  headers?: Record<string, string>
}

export type SdkMcpHttpConfig = {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export type SdkMcpSdkConfig = {
  type: 'sdk'
  name: string
}

export type SdkMcpServerConfig = SdkMcpStdioConfig | SdkMcpSSEConfig | SdkMcpHttpConfig | SdkMcpSdkConfig

export type SdkScopedMcpServerConfig = SdkMcpServerConfig & {
  scope: 'session'
}

// ============================================================================
// createSdkMcpServer() — stub that returns a config object
// ============================================================================

/**
 * Wraps an MCP server configuration for use with the SDK.
 * Adds the 'session' scope marker so the SDK knows this server
 * should be connected per-session (not globally).
 *
 * The `config` parameter must be a valid MCP server config with a
 * transport type and its required fields:
 * - stdio: `{ type: 'stdio', command: '...', args: [...] }`
 * - sse:   `{ type: 'sse', url: '...' }`
 * - http:  `{ type: 'http', url: '...' }`
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
export function createSdkMcpServer(config: SdkMcpServerConfig): SdkScopedMcpServerConfig {
  return {
    ...config,
    scope: 'session' as const,
  }
}

// ============================================================================
// Re-exports — error classes and helpers
// ============================================================================

export {
  AbortError,
  ClaudeError,
  SDKError,
  SDKAuthenticationError,
  SDKBillingError,
  SDKRateLimitError,
  SDKInvalidRequestError,
  SDKServerError,
  SDKMaxOutputTokensError,
  sdkErrorFromType,
} from '../../utils/errors.js'

export type { SDKAssistantMessageError } from '../../utils/errors.js'

export type {
  RewindFilesResult,
  McpServerStatus,
  ApiKeySource,
  PermissionResult,
} from './sdk/coreTypes.generated.js'

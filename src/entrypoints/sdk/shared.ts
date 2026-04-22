/**
 * Shared types, helpers, and mutex for the SDK modules.
 *
 * This module has no sibling imports — it is the foundation for
 * sessions.ts, permissions.ts, query.ts, and v2.ts.
 */

import type { UUID } from 'crypto'
import type {
  SDKMessage as GeneratedSDKMessage,
  SDKUserMessage as GeneratedSDKUserMessage,
} from './coreTypes.generated.js'
import { validateUuid } from '../../utils/sessionStoragePortable.js'

// ============================================================================
// Session ID validation
// ============================================================================

/**
 * Validate sessionId is a proper UUID to prevent path traversal.
 * Throws if invalid.
 */
export function assertValidSessionId(sessionId: string): void {
  if (!validateUuid(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`)
  }
}

// ============================================================================
// Environment mutation mutex for parallel query safety
// ============================================================================

/**
 * Global mutex for process.env mutations.
 * Prevents race conditions when multiple queries run in parallel.
 */
const envMutationQueue: Array<() => void> = []
let envMutationLocked = false

export function acquireEnvMutex(): Promise<void> {
  if (!envMutationLocked) {
    envMutationLocked = true
    return Promise.resolve()
  }
  return new Promise(resolve => {
    envMutationQueue.push(resolve)
  })
}

export function releaseEnvMutex(): void {
  if (envMutationQueue.length > 0) {
    const next = envMutationQueue.shift()
    if (next) next()
  } else {
    envMutationLocked = false
  }
}

// ============================================================================
// SDK Types — snake_case public interface
// ============================================================================

/**
 * Permission request message emitted when a tool needs permission approval.
 * Hosts can respond via respondToPermission() using the request_id.
 */
export type SDKPermissionRequestMessage = {
  type: 'permission_request'
  request_id: string
  tool_name: string
  tool_use_id: string
  input: Record<string, unknown>
  session_id?: string
}

/**
 * Message emitted when a permission request times out without a response.
 * Hosts can detect timeouts by checking `type === 'permission_timeout'`
 * in their `for await` loop. The `tool_use_id` matches the original
 * permission_request, allowing correlation.
 */
export type SDKPermissionTimeoutMessage = {
  type: 'permission_timeout'
  tool_name: string
  tool_use_id: string
  timed_out_after_ms: number
}

/**
 * A message emitted by the query engine during a conversation.
 * Re-exports the full generated type from coreTypes.generated.ts.
 */
export type SDKMessage = GeneratedSDKMessage | SDKPermissionTimeoutMessage

/**
 * A user message fed into query() via AsyncIterable.
 * Re-exports the full generated type from coreTypes.generated.ts.
 */
export type SDKUserMessage = GeneratedSDKUserMessage

/**
 * Map an internal Message object to an SDKMessage.
 * Internal messages have a different shape from SDK types — this function
 * performs the conversion instead of relying on unsafe casts.
 */
export function mapMessageToSDK(msg: Record<string, unknown>): SDKMessage {
  // Internal messages from QueryEngine already use the SDK field naming
  // convention (snake_case: parent_tool_use_id, session_id, etc.).
  // We spread all fields through and let the discriminated-union type
  // narrow via the `type` field.
  return {
    ...msg,
    type: (msg.type as string) ?? 'unknown',
  } as SDKMessage
}

/**
 * Session metadata returned by listSessions and getSessionInfo.
 * Uses snake_case field names matching the public SDK contract.
 */
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

/** Options for listSessions. */
export type ListSessionsOptions = {
  /** Project directory. When omitted, returns sessions across all projects. */
  dir?: string
  /** Maximum number of sessions to return. */
  limit?: number
  /** Number of sessions to skip (pagination). */
  offset?: number
  /** Include git worktree sessions (default true). */
  includeWorktrees?: boolean
}

/** Options for getSessionInfo. */
export type GetSessionInfoOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
}

/** Options for getSessionMessages. */
export type GetSessionMessagesOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
  /** Maximum number of messages to return. */
  limit?: number
  /** Number of messages to skip (pagination). */
  offset?: number
  /** Include system messages in the output. Default false. */
  includeSystemMessages?: boolean
}

/** Options for renameSession and tagSession. */
export type SessionMutationOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
}

/** Options for forkSession. */
export type ForkSessionOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
  /** Fork up to (and including) this message UUID. */
  upToMessageId?: string
  /** Title for the forked session. */
  title?: string
}

/** Result of forkSession. */
export type ForkSessionResult = {
  /** UUID of the newly created forked session. */
  session_id: string
}

/**
 * A single message in a session conversation.
 * Returned by getSessionMessages.
 */
export type SessionMessage = {
  role: 'user' | 'assistant' | 'system'
  content: unknown
  timestamp?: string
  uuid?: string
  parent_uuid?: string | null
  [key: string]: unknown
}

/**
 * Permission mode for the query.
 * Controls how tool permissions are handled.
 */
export type QueryPermissionMode =
  | 'default'
  | 'plan'
  | 'auto-accept'
  | 'bypass-permissions'
  | 'bypassPermissions'
  | 'acceptEdits'

/**
 * Callback type for canUseTool permission checks.
 * Shared between QueryOptions and SDKSessionOptions.
 */
export type CanUseToolCallback = (
  name: string,
  input: unknown,
  options?: { toolUseID?: string },
) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }>

// ============================================================================
// Internal types shared across modules
// ============================================================================

/**
 * JSONL line types used by getSessionMessages and forkSession.
 * @internal
 */
export type JsonlEntry = {
  type: string
  uuid?: string
  parentUuid?: string | null
  sessionId?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
    [key: string]: unknown
  }
  isSidechain?: boolean
  [key: string]: unknown
}

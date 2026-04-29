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

export interface MutexAcquireOptions {
  /** Maximum time to wait for mutex in milliseconds. Default: no timeout (wait forever). */
  timeoutMs?: number
}

export interface MutexAcquireResult {
  /** Whether the mutex was acquired successfully. */
  acquired: boolean
  /** Reason for failure if not acquired. */
  reason?: 'timeout'
}

export async function acquireEnvMutex(options?: MutexAcquireOptions): Promise<MutexAcquireResult> {
  if (!envMutationLocked) {
    envMutationLocked = true
    return { acquired: true }
  }

  if (options?.timeoutMs === undefined) {
    // No timeout - wait forever (original behavior for backward compatibility)
    return new Promise(resolve => {
      envMutationQueue.push(() => resolve({ acquired: true }))
    })
  }

  // With timeout - race between queue and timeout
  return new Promise(resolve => {
    let resolved = false
    let callback: () => void

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        // Remove ourselves from the queue to prevent orphaned callback
        const index = envMutationQueue.indexOf(callback)
        if (index !== -1) {
          envMutationQueue.splice(index, 1)
        }
        resolve({ acquired: false, reason: 'timeout' })
      }
    }, options.timeoutMs)

    callback = () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeoutId)
        resolve({ acquired: true })
      }
    }

    envMutationQueue.push(callback)
  })
}

export function releaseEnvMutex(): void {
  if (envMutationQueue.length > 0) {
    const next = envMutationQueue.shift()
    if (next) {
      try {
        next()
      } catch {
        // If callback throws, ensure mutex is unlocked so next caller can acquire
        // The error is intentionally not propagated - callback errors should not
        // block the mutex system. Callers should handle their own errors.
        envMutationLocked = false
      }
    }
  } else {
    envMutationLocked = false
  }
}

/**
 * Reset mutex state for testing purposes only.
 * Do not use in production code.
 * @internal
 */
export function resetEnvMutexForTesting(): void {
  envMutationQueue.length = 0
  envMutationLocked = false
}

// ============================================================================
// SDK Types — camelCase public interface (matches sdk.d.ts)
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
  uuid: string
  session_id: string
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
  uuid: string
  session_id: string
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
 *
 * Validates that the message is a non-null object and has a valid type field.
 * Returns a message with type='unknown' if type is missing or invalid.
 */
export function mapMessageToSDK(msg: Record<string, unknown>): SDKMessage {
  // Validate input is a non-null object
  if (msg === null || typeof msg !== 'object') {
    throw new TypeError('mapMessageToSDK: expected non-null object')
  }

  // Validate type field is a string (if present)
  const typeValue = msg.type
  if (typeValue !== undefined && typeof typeValue !== 'string') {
    throw new TypeError(`mapMessageToSDK: 'type' field must be string, got ${typeof typeValue}`)
  }

  // Internal messages from QueryEngine already use the SDK field naming
  // convention (snake_case: parent_tool_use_id, session_id, etc.).
  // We spread all fields through and let the discriminated-union type
  // narrow via the `type` field.
  return {
    ...msg,
    type: (typeValue as string) ?? 'unknown',
  } as SDKMessage
}

/**
 * Session metadata returned by listSessions and getSessionInfo.
 * Uses camelCase field names matching the public SDK contract (sdk.d.ts).
 */
export type SDKSessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  createdAt?: number
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
  sessionId: string
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
  parentUuid?: string | null
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

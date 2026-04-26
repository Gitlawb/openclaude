/**
 * Swarm Permission Callback Registry
 *
 * Manages callback registrations for permission requests and responses
 * in agent swarms. Responses are delivered exclusively via the mailbox
 * system (useInboxPoller → processMailboxPermissionResponse).
 *
 * The legacy file-based polling (resolved/ directory) has been removed
 * because it created an unauthenticated attack surface — any local process
 * could forge approval files. The mailbox path is the sole active channel.
 */

import { logForDebugging } from '../utils/debug.js'
import {
  type PermissionUpdate,
  permissionUpdateSchema,
} from '../utils/permissions/PermissionUpdateSchema.js'

/**
 * Validate permissionUpdates from external sources (mailbox IPC).
 * Malformed entries from buggy/old teammate processes are filtered out rather
 * than propagated unchecked into callback.onAllow().
 */
function parsePermissionUpdates(raw: unknown): PermissionUpdate[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const schema = permissionUpdateSchema()
  const valid: PermissionUpdate[] = []
  for (const entry of raw) {
    const result = schema.safeParse(entry)
    if (result.success) {
      valid.push(result.data)
    } else {
      logForDebugging(
        `[SwarmPermissionPoller] Dropping malformed permissionUpdate entry: ${result.error.message}`,
        { level: 'warn' },
      )
    }
  }
  return valid
}

/**
 * Callback signature for handling permission responses
 */
export type PermissionResponseCallback = {
  requestId: string
  toolUseId: string
  onAllow: (
    updatedInput: Record<string, unknown> | undefined,
    permissionUpdates: PermissionUpdate[],
    feedback?: string,
  ) => void
  onReject: (feedback?: string) => void
}

/**
 * Registry for pending permission request callbacks
 * This allows the poller to find and invoke the right callbacks when responses arrive
 */
type PendingCallbackRegistry = Map<string, PermissionResponseCallback>

// Module-level registry that persists across renders
const pendingCallbacks: PendingCallbackRegistry = new Map()

/**
 * Register a callback for a pending permission request
 * Called by useCanUseTool when a worker submits a permission request
 */
export function registerPermissionCallback(
  callback: PermissionResponseCallback,
): void {
  pendingCallbacks.set(callback.requestId, callback)
  logForDebugging(
    `[SwarmPermissionPoller] Registered callback for request ${callback.requestId}`,
  )
}

/**
 * Unregister a callback (e.g., when the request is resolved locally or times out)
 */
export function unregisterPermissionCallback(requestId: string): void {
  pendingCallbacks.delete(requestId)
  logForDebugging(
    `[SwarmPermissionPoller] Unregistered callback for request ${requestId}`,
  )
}

/**
 * Check if a request has a registered callback
 */
export function hasPermissionCallback(requestId: string): boolean {
  return pendingCallbacks.has(requestId)
}

/**
 * Clear all pending callbacks (both permission and sandbox).
 * Called from clearSessionCaches() on /clear to reset stale state,
 * and also used in tests for isolation.
 */
export function clearAllPendingCallbacks(): void {
  pendingCallbacks.clear()
  pendingSandboxCallbacks.clear()
}

/**
 * Process a permission response from a mailbox message.
 * This is called by the inbox poller when it detects a permission_response message.
 *
 * @returns true if the response was processed, false if no callback was registered
 */
export function processMailboxPermissionResponse(params: {
  requestId: string
  decision: 'approved' | 'rejected'
  feedback?: string
  updatedInput?: Record<string, unknown>
  permissionUpdates?: unknown
}): boolean {
  const callback = pendingCallbacks.get(params.requestId)

  if (!callback) {
    logForDebugging(
      `[SwarmPermissionPoller] No callback registered for mailbox response ${params.requestId}`,
    )
    return false
  }

  logForDebugging(
    `[SwarmPermissionPoller] Processing mailbox response for request ${params.requestId}: ${params.decision}`,
  )

  // Remove from registry before invoking callback
  pendingCallbacks.delete(params.requestId)

  if (params.decision === 'approved') {
    const permissionUpdates = parsePermissionUpdates(params.permissionUpdates)
    const updatedInput = params.updatedInput
    callback.onAllow(updatedInput, permissionUpdates)
  } else {
    callback.onReject(params.feedback)
  }

  return true
}

// ============================================================================
// Sandbox Permission Callback Registry
// ============================================================================

/**
 * Callback signature for handling sandbox permission responses
 */
export type SandboxPermissionResponseCallback = {
  requestId: string
  host: string
  resolve: (allow: boolean) => void
}

// Module-level registry for sandbox permission callbacks
const pendingSandboxCallbacks: Map<string, SandboxPermissionResponseCallback> =
  new Map()

/**
 * Register a callback for a pending sandbox permission request
 * Called when a worker sends a sandbox permission request to the leader
 */
export function registerSandboxPermissionCallback(
  callback: SandboxPermissionResponseCallback,
): void {
  pendingSandboxCallbacks.set(callback.requestId, callback)
  logForDebugging(
    `[SwarmPermissionPoller] Registered sandbox callback for request ${callback.requestId}`,
  )
}

/**
 * Check if a sandbox request has a registered callback
 */
export function hasSandboxPermissionCallback(requestId: string): boolean {
  return pendingSandboxCallbacks.has(requestId)
}

/**
 * Process a sandbox permission response from a mailbox message.
 * Called by the inbox poller when it detects a sandbox_permission_response message.
 *
 * @returns true if the response was processed, false if no callback was registered
 */
export function processSandboxPermissionResponse(params: {
  requestId: string
  host: string
  allow: boolean
}): boolean {
  const callback = pendingSandboxCallbacks.get(params.requestId)

  if (!callback) {
    logForDebugging(
      `[SwarmPermissionPoller] No sandbox callback registered for request ${params.requestId}`,
    )
    return false
  }

  logForDebugging(
    `[SwarmPermissionPoller] Processing sandbox response for request ${params.requestId}: allow=${params.allow}`,
  )

  // Remove from registry before invoking callback
  pendingSandboxCallbacks.delete(params.requestId)

  // Resolve the promise with the allow decision
  callback.resolve(params.allow)

  return true
}

// Legacy file-based polling (useSwarmPermissionPoller, processResponse)
// has been removed. Permission responses are now delivered exclusively
// via the mailbox system:
//   Leader: sendPermissionResponseViaMailbox() → writeToMailbox()
//   Worker: useInboxPoller → processMailboxPermissionResponse()
// See: fix(security) — remove unauthenticated file-based permission channel

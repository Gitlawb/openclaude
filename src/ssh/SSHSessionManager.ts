/**
 * Session manager for `claude ssh` remote sessions (SSH_REMOTE-gated).
 *
 * The manager owns the stream-json protocol over the ssh child process:
 * it forwards user messages/interrupts to the remote CLI and surfaces
 * remote SDK messages, permission requests, and lifecycle events to the
 * REPL via callbacks (see src/hooks/useSSHSession.ts).
 */

import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { SDKControlPermissionRequest } from '../entrypoints/sdk/controlTypes.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'

/** Response to a remote permission request. */
export type SSHPermissionResponse =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/** Callbacks wired up by useSSHSession when creating a manager. */
export type SSHSessionManagerCallbacks = {
  /** A message arrived from the remote CLI's stream-json output. */
  onMessage: (sdkMessage: SDKMessage) => void
  /** The remote CLI is asking for tool permission. */
  onPermissionRequest: (
    request: SDKControlPermissionRequest,
    requestId: string,
  ) => void
  /** The ssh transport (re)connected and the remote CLI is ready. */
  onConnected: () => void
  /** The ssh connection dropped; a reconnect attempt is in progress. */
  onReconnecting: (attempt: number, maxAttempts: number) => void
  /** The ssh process exited and reconnection has been given up. */
  onDisconnected: () => void
  /** A non-fatal protocol/transport error occurred. */
  onError: (error: Error) => void
}

/**
 * Interface of the object returned by SSHSession.createManager().
 */
export type SSHSessionManager = {
  /** Begin reading the remote stream and dispatching callbacks. */
  connect(): void
  /** Stop reading and tear down the underlying ssh process wiring. */
  disconnect(): void
  /**
   * Send a user message to the remote CLI.
   * Resolves true when the message was written to the transport.
   */
  sendMessage(content: RemoteMessageContent): Promise<boolean>
  /** Interrupt the in-flight remote request (Esc). */
  sendInterrupt(): void
  /** Answer a pending permission request by id. */
  respondToPermissionRequest(
    requestId: string,
    response: SSHPermissionResponse,
  ): void
}

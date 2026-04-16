/**
 * Binds the local HTTP+WebSocket server to the running Neural Network session.
 *
 * Responsibilities:
 *   - Translate `localRemoteEvents` (messagesChanged, permissionPending, etc.)
 *     into outbound `ServerEvent`s.
 *   - Translate inbound `ClientEvent`s into session actions via
 *     `sessionRegistry` (submit prompt, settle permission).
 *   - Buffer the current message snapshot so a freshly connected client
 *     receives it immediately on connect.
 *
 * This module owns no transport state — it plugs a server handle into the
 * session. Lifecycle is managed by `index.ts`.
 */

import { randomUUID } from 'crypto'
import type { Message } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { isEligibleBridgeMessage } from '../bridge/bridgeMessaging.js'
import * as events from './localRemoteEvents.js'
import type { LocalRemoteServerHandle } from './localRemoteServer.js'
import {
  getPromptSubmitter,
  settlePermission,
} from './sessionRegistry.js'
import type {
  ClientEvent,
  RemotePermissionRequest,
  ServerEvent,
} from './types.js'

type BridgeContext = {
  sessionId: string
  cwd: string
  serverVersion: string
}

export type LocalRemoteBridgeHandle = {
  /** Tear down subscriptions; does not close the server. */
  dispose: () => void
  /** Called by the server when a client (re)connects. */
  onClientConnected: () => void
  /** Called by the server when a client disconnects. */
  onClientDisconnected: () => void
  /** Called by the server when a client message arrives. */
  onClientMessage: (event: ClientEvent) => void
}

export function bindLocalRemoteBridge(
  server: LocalRemoteServerHandle,
  context: BridgeContext,
): LocalRemoteBridgeHandle {
  let latestMessages: Message[] = []
  let latestLoading = false
  let latestSpinnerVerb: string | undefined
  const pending = new Map<string, RemotePermissionRequest>()

  const unsubscribers: Array<() => void> = []

  unsubscribers.push(
    events.on('messagesChanged', (messages: Message[]) => {
      latestMessages = filterForWire(messages)
      server.send({ type: 'messages', messages: latestMessages })
    }),
  )

  unsubscribers.push(
    events.on('loadingChanged', (isLoading: boolean, spinnerVerb?: string) => {
      latestLoading = isLoading
      latestSpinnerVerb = isLoading ? spinnerVerb : undefined
      server.send({ type: 'status', isLoading, spinnerVerb: latestSpinnerVerb })
    }),
  )

  unsubscribers.push(
    events.on('permissionPending', (request: RemotePermissionRequest) => {
      pending.set(request.requestId, request)
      server.send({ type: 'permission_req', request })
    }),
  )

  unsubscribers.push(
    events.on('permissionResolved', (requestId: string) => {
      if (pending.delete(requestId)) {
        server.send({ type: 'permission_clear', requestId })
      }
    }),
  )

  const sendSnapshot = (): void => {
    server.send({
      type: 'hello',
      sessionId: context.sessionId,
      cwd: context.cwd,
      serverVersion: context.serverVersion,
    })
    server.send({ type: 'snapshot', messages: latestMessages })
    server.send({ type: 'status', isLoading: latestLoading, spinnerVerb: latestSpinnerVerb })
    for (const req of pending.values()) {
      server.send({ type: 'permission_req', request: req })
    }
  }

  const onClientMessage = (event: ClientEvent): void => {
    switch (event.type) {
      case 'prompt': {
        const submitter = getPromptSubmitter()
        if (!submitter) {
          server.send({
            type: 'error',
            message: 'No active session. Open Neural Network first.',
          })
          return
        }
        const text = String(event.text ?? '').trim()
        if (!text) return
        try {
          submitter(text)
        } catch (err) {
          logForDebugging(
            `[localRemote] prompt submission failed: ${String(err)}`,
          )
          server.send({
            type: 'error',
            message: 'Prompt rejected by session.',
          })
        }
        return
      }
      case 'permission_response': {
        const ok = settlePermission(
          event.requestId,
          event.behavior,
          event.message,
        )
        if (!ok) {
          server.send({ type: 'permission_clear', requestId: event.requestId })
        }
        return
      }
      case 'ping':
        return
      default:
        // Forward-compat: ignore unknown event types.
        return
    }
  }

  return {
    dispose: () => {
      for (const u of unsubscribers) u()
    },
    onClientConnected: sendSnapshot,
    onClientDisconnected: () => {
      // Nothing to do — next connect will resend the snapshot.
    },
    onClientMessage,
  }
}

function filterForWire(messages: Message[]): Message[] {
  // Preserve order; drop REPL-internal chatter the client shouldn't see.
  // Reuse the bridge's core filter (user/assistant/system:local_command) and
  // additionally forward informational system subtypes the remote UI can show
  // inline — turn duration ("Cooked for 4m 54s") lands here.
  return messages.filter(m => {
    if (isEligibleBridgeMessage(m)) return true
    if (m.type === 'system') {
      const sub = (m as { subtype?: string }).subtype
      return sub === 'turn_duration'
    }
    return false
  })
}

/** Generate a fresh permission request id. Exposed for the settler plumbing. */
export function mintRequestId(): string {
  return randomUUID()
}

/** Build a user-facing request shape from raw tool fields. */
export function buildPermissionRequest(
  toolName: string,
  opts: {
    requestId?: string
    description?: string
    input?: unknown
  } = {},
): RemotePermissionRequest {
  return {
    requestId: opts.requestId ?? mintRequestId(),
    toolName,
    description: opts.description,
    input: opts.input,
    createdAt: Date.now(),
  }
}

// Re-export for callers that shouldn't import the event bus directly.
export type { ServerEvent } from './types.js'

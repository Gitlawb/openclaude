/**
 * Wire protocol for the local-remote bridge.
 *
 * Server → client events:
 *   - `hello`          : sent once after auth; server state snapshot
 *   - `snapshot`       : full message history (sent on connect or /remote on)
 *   - `messages`       : replacement of the full message list (cheap for MVP)
 *   - `permission_req` : tool permission prompt the TUI is waiting on
 *   - `permission_clear`: the prompt was resolved (by TUI, client, or cancel)
 *   - `status`         : session status (loading, idle)
 *   - `error`          : server-side error notification
 *
 * Client → server events:
 *   - `prompt`              : submit a user prompt
 *   - `permission_response` : respond to a pending permission request
 *   - `ping`                : keepalive
 */

import type { Message } from '../types/message.js'

export type PermissionBehavior = 'allow' | 'deny'

export type RemotePermissionRequest = {
  requestId: string
  toolName: string
  /** Best-effort text description of what the tool will do. */
  description?: string
  /** Serialised tool input (JSON-able). */
  input?: unknown
  /** When the request appeared (ms since epoch). */
  createdAt: number
}

// ─── Server → Browser (client) events ────────────────────────────────
export type ServerEvent =
  | {
      type: 'hello'
      sessionId: string
      cwd: string
      serverVersion: string
    }
  | {
      type: 'snapshot'
      messages: Message[]
    }
  | {
      type: 'messages'
      messages: Message[]
    }
  | {
      type: 'permission_req'
      request: RemotePermissionRequest
    }
  | {
      type: 'permission_clear'
      requestId: string
    }
  | {
      type: 'status'
      isLoading: boolean
      spinnerVerb?: string
    }
  | {
      type: 'error'
      message: string
    }
  | {
      type: 'sessions'
      sessions: SessionSummary[]
    }
  | {
      type: 'session_gone'
      sessionId: string
    }

// ─── Browser (client) → Server events ────────────────────────────────
export type ClientEvent =
  | {
      type: 'prompt'
      text: string
    }
  | {
      type: 'permission_response'
      requestId: string
      behavior: PermissionBehavior
      /** Optional message surfaced alongside a denial. */
      message?: string
    }
  | {
      type: 'ping'
    }
  | {
      type: 'select_session'
      sessionId: string
    }

// ─── Worker → Daemon events ──────────────────────────────────────────
export type WorkerToDaemonEvent =
  | {
      type: 'register'
      sessionId: string
      cwd: string
      pid: number
      title: string
      startedAt: number
      serverVersion: string
    }
  | {
      type: 'messages'
      messages: Message[]
    }
  | {
      type: 'status'
      isLoading: boolean
      spinnerVerb?: string
    }
  | {
      type: 'permission_req'
      request: RemotePermissionRequest
    }
  | {
      type: 'permission_clear'
      requestId: string
    }
  | {
      type: 'error'
      message: string
    }
  | {
      type: 'bye'
      reason?: string
    }

// ─── Daemon → Worker events ──────────────────────────────────────────
export type DaemonToWorkerEvent =
  | {
      type: 'hello'
      ok: true
    }
  | {
      type: 'prompt'
      text: string
    }
  | {
      type: 'permission_response'
      requestId: string
      behavior: PermissionBehavior
      message?: string
    }
  | {
      type: 'kick'
      code: number
      reason: string
    }

// ─── Session summary (for /api/sessions + sessions WS event) ────────
export type SessionSummary = {
  id: string
  cwd: string
  pid: number
  title: string
  startedAt: number
  isLoading: boolean
  hasPendingPermission: boolean
}

/** Result of the `/remote on` command. */
export type StartResult = {
  url: string
  lanUrl?: string
  token: string
  port: number
  host: string
}

/** Runtime status returned by `/remote status`. */
export type ServerStatus =
  | { running: false }
  | {
      running: true
      url: string
      lanUrl?: string
      port: number
      host: string
      tokenPreview: string
      connectedToDaemon: boolean
      sessionCount?: number
    }

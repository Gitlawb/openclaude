// Wire protocol types.
// These MUST stay in sync with src/localRemote/types.ts in the Neural Network repo.
// They're duplicated here instead of cross-imported so this client can ship
// and run independently.

export type PermissionBehavior = 'allow' | 'deny'

/** A content block as delivered by the Neural Network SDK message shape. */
export interface ContentBlock {
  type: string
  text?: string
  name?: string
  input?: unknown
  content?: string | ContentBlock[]
  source?: { type: string; media_type?: string; data?: string }
  [extra: string]: unknown
}

/** Relaxed shape — we only read fields we recognise. */
export interface WireMessage {
  type: 'user' | 'assistant' | 'system'
  subtype?: string
  /** Some messages wrap an inner message object. */
  message?: { content?: string | ContentBlock[]; role?: string }
  content?: string | ContentBlock[]
  uuid?: string
  isMeta?: boolean
  /** Turn-duration system message — populated when subtype === 'turn_duration'. */
  durationMs?: number
  /** Anything else we don't care about. */
  [extra: string]: unknown
}

export interface RemotePermissionRequest {
  requestId: string
  toolName: string
  description?: string
  input?: unknown
  createdAt: number
}

export type ServerEvent =
  | { type: 'hello'; sessionId: string; cwd: string; serverVersion: string }
  | { type: 'snapshot'; messages: WireMessage[] }
  | { type: 'messages'; messages: WireMessage[] }
  | { type: 'permission_req'; request: RemotePermissionRequest }
  | { type: 'permission_clear'; requestId: string }
  | { type: 'status'; isLoading: boolean; spinnerVerb?: string }
  | { type: 'error'; message: string }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'session_gone'; sessionId: string }

export type ClientEvent =
  | { type: 'prompt'; text: string }
  | {
      type: 'permission_response'
      requestId: string
      behavior: PermissionBehavior
      message?: string
    }
  | { type: 'ping' }
  | { type: 'select_session'; sessionId: string }

export interface SessionSummary {
  id: string
  cwd: string
  pid: number
  title: string
  startedAt: number
  isLoading: boolean
  hasPendingPermission: boolean
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface SessionInfo {
  sessionId: string
  cwd: string
  serverVersion: string
}

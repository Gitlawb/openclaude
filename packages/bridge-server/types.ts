/**
 * Shared types for the local bridge server.
 *
 * These types mirror the Anthropic CCR v2 protocol structures so the
 * existing bridge client code connects transparently.
 */

export type SessionState = 'idle' | 'running' | 'requires_action'

export type SessionEvent = {
  eventId: string
  sequenceNum: number
  eventType: string
  source: string
  payload: Record<string, unknown>
  createdAt: string
  ephemeral?: boolean
}

export type InternalEvent = SessionEvent & {
  isCompaction?: boolean
  agentId?: string
}

export type Session = {
  id: string
  workerEpoch: number
  workerJwt: string | null
  workerStatus: SessionState
  events: SessionEvent[]
  internalEvents: InternalEvent[]
  workerStream: ReadableStreamController<Uint8Array> | null
  clientStreams: Set<ReadableStreamController<Uint8Array>>
  lastHeartbeat: number
  sequenceCounter: number
  metadata: Record<string, unknown>
  createdAt: string
  archived: boolean
}

// --- CCR v2 API request/response shapes ---

export type CreateSessionResponse = {
  session: { id: string }
}

export type BridgeCredentialsResponse = {
  worker_jwt: string
  api_base_url: string
  expires_in: number
  worker_epoch: number
}

export type WorkerInitRequest = {
  worker_status: SessionState
  worker_epoch: number
  external_metadata?: Record<string, unknown>
  requires_action_details?: {
    tool_name: string
    action_description: string
    request_id: string
  } | null
}

export type WorkerEventsRequest = {
  worker_epoch: number
  events: Array<{
    payload: Record<string, unknown>
    ephemeral?: boolean
  }>
}

export type InternalEventsRequest = {
  worker_epoch: number
  events: Array<{
    payload: Record<string, unknown>
    is_compaction?: boolean
    agent_id?: string
  }>
}

export type DeliveryUpdate = {
  event_id: string
  status: 'received' | 'processing' | 'processed'
}

export type DeliveryRequest = {
  worker_epoch: number
  updates: DeliveryUpdate[]
}

export type HeartbeatRequest = {
  session_id: string
  worker_epoch: number
}

export type ServerConfig = {
  port: number
  host: string
  jwtSecret: string
}

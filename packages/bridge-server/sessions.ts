/**
 * In-memory session registry.
 *
 * Manages session lifecycle: create, credentials, epoch tracking,
 * event storage, and SSE stream management.
 */

import { randomUUID } from 'crypto'
import { signJwt } from './jwt.js'
import type {
  BridgeCredentialsResponse,
  InternalEvent,
  Session,
  SessionEvent,
  SessionState,
} from './types.js'

const sessions = new Map<string, Session>()

export function createSession(): Session {
  const id = `cse_${randomUUID().replace(/-/g, '')}`
  const session: Session = {
    id,
    workerEpoch: 0,
    workerJwt: null,
    workerStatus: 'idle',
    events: [],
    internalEvents: [],
    workerStream: null,
    clientStreams: new Set(),
    lastHeartbeat: Date.now(),
    sequenceCounter: 0,
    metadata: {},
    createdAt: new Date().toISOString(),
    archived: false,
  }
  sessions.set(id, session)
  return session
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function issueCredentials(
  session: Session,
  jwtSecret: string,
  apiBaseUrl: string,
): BridgeCredentialsResponse {
  // Bump epoch — each /bridge call is a new worker registration
  session.workerEpoch++
  const expiresIn = 3600
  session.workerJwt = signJwt(session.id, session.workerEpoch, jwtSecret, expiresIn)
  session.lastHeartbeat = Date.now()

  return {
    worker_jwt: session.workerJwt,
    api_base_url: apiBaseUrl,
    expires_in: expiresIn,
    worker_epoch: session.workerEpoch,
  }
}

export function checkEpoch(session: Session, epoch: number): boolean {
  return session.workerEpoch === epoch
}

export function updateWorkerStatus(
  session: Session,
  status: SessionState,
  metadata?: Record<string, unknown>,
): void {
  session.workerStatus = status
  if (metadata) {
    session.metadata = { ...session.metadata, ...metadata }
  }
  session.lastHeartbeat = Date.now()
}

export function heartbeat(session: Session): void {
  session.lastHeartbeat = Date.now()
}

export function addWorkerEvents(
  session: Session,
  payloads: Array<{ payload: Record<string, unknown>; ephemeral?: boolean }>,
): SessionEvent[] {
  const added: SessionEvent[] = []
  for (const { payload, ephemeral } of payloads) {
    const evt: SessionEvent = {
      eventId: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      sequenceNum: ++session.sequenceCounter,
      eventType: (payload.type as string) ?? 'unknown',
      source: 'worker',
      payload,
      createdAt: new Date().toISOString(),
      ephemeral,
    }
    if (!ephemeral) {
      session.events.push(evt)
    }
    added.push(evt)
  }
  return added
}

export function addInternalEvents(
  session: Session,
  payloads: Array<{
    payload: Record<string, unknown>
    is_compaction?: boolean
    agent_id?: string
  }>,
): void {
  for (const { payload, is_compaction, agent_id } of payloads) {
    const evt: InternalEvent = {
      eventId: `ievt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      sequenceNum: ++session.sequenceCounter,
      eventType: (payload.type as string) ?? 'unknown',
      source: 'worker',
      payload,
      createdAt: new Date().toISOString(),
      isCompaction: is_compaction,
      agentId: agent_id,
    }
    session.internalEvents.push(evt)
  }
}

/**
 * Push an event to the worker's SSE stream (inbound to CLI).
 * Called when a client (web UI) sends a message to the session.
 */
export function pushToWorkerStream(session: Session, event: SessionEvent): void {
  if (!session.workerStream) return
  const frame = formatSSEFrame(event)
  try {
    session.workerStream.enqueue(new TextEncoder().encode(frame))
  } catch {
    // Stream closed — will be cleaned up by the close handler
    session.workerStream = null
  }
}

/**
 * Push an event to all connected client SSE streams (outbound from CLI).
 */
export function pushToClientStreams(session: Session, event: SessionEvent): void {
  const frame = formatSSEFrame(event)
  const encoded = new TextEncoder().encode(frame)
  for (const controller of session.clientStreams) {
    try {
      controller.enqueue(encoded)
    } catch {
      session.clientStreams.delete(controller)
    }
  }
}

export function archiveSession(id: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.archived = true
  return true
}

function formatSSEFrame(event: SessionEvent): string {
  const data = JSON.stringify({
    event_id: event.eventId,
    sequence_num: event.sequenceNum,
    event_type: event.eventType,
    source: event.source,
    payload: event.payload,
    created_at: event.createdAt,
  })
  return `event: client_event\nid: ${event.sequenceNum}\ndata: ${data}\n\n`
}

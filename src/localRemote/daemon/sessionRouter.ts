/**
 * In-memory session registry inside the daemon process.
 *
 * Tracks all connected worker sessions and their state, routes messages
 * between workers and browser clients, and broadcasts session list changes.
 */

import type { Message } from '../../types/message.js'
import type {
  ClientEvent,
  DaemonToWorkerEvent,
  RemotePermissionRequest,
  ServerEvent,
  SessionSummary,
  WorkerToDaemonEvent,
} from '../types.js'

type Send<T> = (event: T) => void

export type WorkerEntry = {
  sessionId: string
  cwd: string
  pid: number
  title: string
  startedAt: number
  serverVersion: string
  messages: Message[]
  isLoading: boolean
  spinnerVerb?: string
  pendingPermissions: Map<string, RemotePermissionRequest>
  send: Send<DaemonToWorkerEvent>
}

export type ClientEntry = {
  /** The sessionId this client is subscribed to (empty = lobby only). */
  subscribedSession: string
  send: Send<ServerEvent>
}

export class SessionRouter {
  readonly workers = new Map<string, WorkerEntry>()
  readonly clients = new Set<ClientEntry>()

  // ─── Worker lifecycle ────────────────────────────────────────────

  registerWorker(
    event: Extract<WorkerToDaemonEvent, { type: 'register' }>,
    send: Send<DaemonToWorkerEvent>,
  ): WorkerEntry {
    // If a worker with same sessionId is already registered, kick it.
    const existing = this.workers.get(event.sessionId)
    if (existing) {
      existing.send({ type: 'kick', code: 4001, reason: 'duplicate sessionId' })
    }

    const entry: WorkerEntry = {
      sessionId: event.sessionId,
      cwd: event.cwd,
      pid: event.pid,
      title: event.title,
      startedAt: event.startedAt,
      serverVersion: event.serverVersion,
      messages: [],
      isLoading: false,
      pendingPermissions: new Map(),
      send,
    }
    this.workers.set(event.sessionId, entry)
    send({ type: 'hello', ok: true })
    this.broadcastSessionList()
    return entry
  }

  unregisterWorker(sessionId: string): void {
    this.workers.delete(sessionId)

    // Notify clients subscribed to this session.
    for (const client of this.clients) {
      if (client.subscribedSession === sessionId) {
        client.send({ type: 'session_gone', sessionId })
        client.subscribedSession = ''
      }
    }
    this.broadcastSessionList()
  }

  // ─── Worker events → state + relay to clients ────────────────────

  handleWorkerEvent(sessionId: string, event: WorkerToDaemonEvent): void {
    const worker = this.workers.get(sessionId)
    if (!worker) return

    switch (event.type) {
      case 'messages':
        worker.messages = event.messages
        this.relayToSubscribers(sessionId, { type: 'messages', messages: event.messages })
        break

      case 'status':
        worker.isLoading = event.isLoading
        worker.spinnerVerb = event.isLoading ? event.spinnerVerb : undefined
        this.relayToSubscribers(sessionId, { type: 'status', isLoading: event.isLoading, spinnerVerb: worker.spinnerVerb })
        this.broadcastSessionList()
        break

      case 'permission_req':
        worker.pendingPermissions.set(event.request.requestId, event.request)
        this.relayToSubscribers(sessionId, { type: 'permission_req', request: event.request })
        this.broadcastSessionList()
        break

      case 'permission_clear':
        worker.pendingPermissions.delete(event.requestId)
        this.relayToSubscribers(sessionId, { type: 'permission_clear', requestId: event.requestId })
        this.broadcastSessionList()
        break

      case 'error':
        this.relayToSubscribers(sessionId, { type: 'error', message: event.message })
        break

      case 'bye':
        this.unregisterWorker(sessionId)
        break

      // 'register' is handled separately.
    }
  }

  // ─── Client lifecycle ────────────────────────────────────────────

  addClient(send: Send<ServerEvent>, initialSession: string): ClientEntry {
    const entry: ClientEntry = { subscribedSession: '', send }
    this.clients.add(entry)

    // Always send session list first.
    send({ type: 'sessions', sessions: this.getSessionList() })

    if (initialSession) {
      this.subscribeClientToSession(entry, initialSession)
    }
    return entry
  }

  removeClient(client: ClientEntry): void {
    this.clients.delete(client)
  }

  handleClientEvent(client: ClientEntry, event: ClientEvent): void {
    switch (event.type) {
      case 'select_session':
        this.subscribeClientToSession(client, event.sessionId)
        break

      case 'prompt': {
        const worker = this.workers.get(client.subscribedSession)
        if (!worker) {
          client.send({ type: 'error', message: 'Session not found or disconnected.' })
          return
        }
        worker.send({ type: 'prompt', text: event.text })
        break
      }

      case 'permission_response': {
        const worker = this.workers.get(client.subscribedSession)
        if (!worker) return
        worker.send({
          type: 'permission_response',
          requestId: event.requestId,
          behavior: event.behavior,
          message: event.message,
        })
        break
      }

      case 'ping':
        break
    }
  }

  // ─── Internal ────────────────────────────────────────────────────

  private subscribeClientToSession(client: ClientEntry, sessionId: string): void {
    client.subscribedSession = sessionId
    const worker = this.workers.get(sessionId)
    if (!worker) {
      client.send({ type: 'error', message: `Session "${sessionId}" not found.` })
      return
    }

    // Send snapshot for the selected session.
    client.send({
      type: 'hello',
      sessionId: worker.sessionId,
      cwd: worker.cwd,
      serverVersion: worker.serverVersion,
    })
    client.send({ type: 'snapshot', messages: worker.messages })
    client.send({ type: 'status', isLoading: worker.isLoading, spinnerVerb: worker.spinnerVerb })
    for (const req of worker.pendingPermissions.values()) {
      client.send({ type: 'permission_req', request: req })
    }
  }

  private relayToSubscribers(sessionId: string, event: ServerEvent): void {
    for (const client of this.clients) {
      if (client.subscribedSession === sessionId) {
        client.send(event)
      }
    }
  }

  getSessionList(): SessionSummary[] {
    const list: SessionSummary[] = []
    for (const w of this.workers.values()) {
      list.push({
        id: w.sessionId,
        cwd: w.cwd,
        pid: w.pid,
        title: w.title,
        startedAt: w.startedAt,
        isLoading: w.isLoading,
        hasPendingPermission: w.pendingPermissions.size > 0,
      })
    }
    return list
  }

  private broadcastSessionList(): void {
    const sessions = this.getSessionList()
    const event: ServerEvent = { type: 'sessions', sessions }
    for (const client of this.clients) {
      client.send(event)
    }
  }
}

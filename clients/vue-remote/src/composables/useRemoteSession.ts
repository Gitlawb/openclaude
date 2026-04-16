// Connects to a Neural Network `/remote` server over WebSocket and exposes
// its state as Vue refs. Handles:
//   - bearer-token auth via ?token= query
//   - automatic WS upgrade (wss when the origin is https)
//   - exponential-backoff reconnect (capped at 20s)
//   - snapshot / incremental message updates
//   - permission request / response relay
//   - keepalive pings every 30s

import { ref, shallowRef, type Ref } from 'vue'
import { t } from '../i18n'
import type {
  ClientEvent,
  ConnectionState,
  PermissionBehavior,
  RemotePermissionRequest,
  ServerEvent,
  SessionInfo,
  SessionSummary,
  WireMessage,
} from '../types'

const PING_INTERVAL_MS = 30_000
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 20_000

export interface RemoteSession {
  connectionState: Ref<ConnectionState>
  isLoading: Ref<boolean>
  spinnerVerb: Ref<string | null>
  messages: Ref<WireMessage[]>
  pendingPermission: Ref<RemotePermissionRequest | null>
  error: Ref<string | null>
  sessionInfo: Ref<SessionInfo | null>
  /** The URL the user entered, even if the socket is down. */
  currentUrl: Ref<string>
  /** Live session list pushed by the daemon. */
  sessions: Ref<SessionSummary[]>
  /** The currently selected session id (empty = none). */
  selectedSessionId: Ref<string>

  connect: (url: string, token: string) => void
  disconnect: () => void
  sendPrompt: (text: string) => boolean
  selectSession: (sessionId: string) => void
  respondToPermission: (
    requestId: string,
    behavior: PermissionBehavior,
    message?: string,
  ) => boolean
}

export function useRemoteSession(): RemoteSession {
  const connectionState = ref<ConnectionState>('disconnected')
  const isLoading = ref(false)
  const spinnerVerb = ref<string | null>(null)
  const messages = shallowRef<WireMessage[]>([])
  const pendingPermission = ref<RemotePermissionRequest | null>(null)
  const error = ref<string | null>(null)
  const sessionInfo = ref<SessionInfo | null>(null)
  const currentUrl = ref('')
  const sessions = ref<SessionSummary[]>([])
  const selectedSessionId = ref('')

  let ws: WebSocket | null = null
  let desiredUrl = ''
  let desiredToken = ''
  let explicitlyClosed = false
  let backoff = INITIAL_BACKOFF_MS
  let reconnectTimer: number | null = null
  let pingTimer: number | null = null

  function buildWsUrl(baseUrl: string, tokenValue: string, sessionId?: string): string {
    let url: URL
    try {
      url = new URL(baseUrl)
    } catch {
      throw new Error(t.connect.errorInvalidUrl)
    }
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let wsUrl = `${proto}//${url.host}/ws/client?token=${encodeURIComponent(tokenValue)}`
    if (sessionId) {
      wsUrl += `&sessionId=${encodeURIComponent(sessionId)}`
    }
    return wsUrl
  }

  function clearTimers() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (pingTimer !== null) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function scheduleReconnect() {
    if (explicitlyClosed) return
    connectionState.value = 'reconnecting'
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      openSocket()
    }, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }

  function openSocket() {
    if (!desiredUrl || !desiredToken) return
    let wsUrl: string
    try {
      wsUrl = buildWsUrl(desiredUrl, desiredToken)
    } catch (err) {
      error.value = (err as Error).message
      connectionState.value = 'error'
      return
    }

    connectionState.value = connectionState.value === 'reconnecting'
      ? 'reconnecting'
      : 'connecting'
    error.value = null

    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl)
    } catch (err) {
      error.value = `${t.errors.openFailed}: ${String(err)}`
      connectionState.value = 'error'
      scheduleReconnect()
      return
    }
    ws = socket

    socket.addEventListener('open', () => {
      connectionState.value = 'connected'
      backoff = INITIAL_BACKOFF_MS
      error.value = null
      pingTimer = window.setInterval(() => {
        send({ type: 'ping' })
      }, PING_INTERVAL_MS)
    })

    socket.addEventListener('message', ev => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return
      handleServerEvent(parsed as ServerEvent)
    })

    socket.addEventListener('close', ev => {
      ws = null
      clearTimers()
      isLoading.value = false
      if (ev.code === 4001) {
        error.value = t.errors.superseded
        connectionState.value = 'error'
        explicitlyClosed = true
        return
      }
      if (ev.code === 4000) {
        error.value = t.errors.stopped
        connectionState.value = 'disconnected'
        explicitlyClosed = true
        return
      }
      if (explicitlyClosed) {
        connectionState.value = 'disconnected'
        return
      }
      scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      // close will follow; don't preempt state here, just note the issue.
      if (connectionState.value !== 'reconnecting') {
        error.value = t.errors.connection
      }
    })
  }

  function handleServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'hello':
        sessionInfo.value = {
          sessionId: event.sessionId,
          cwd: event.cwd,
          serverVersion: event.serverVersion,
        }
        return
      case 'snapshot':
      case 'messages':
        messages.value = event.messages ?? []
        return
      case 'permission_req':
        pendingPermission.value = event.request
        return
      case 'permission_clear':
        if (pendingPermission.value?.requestId === event.requestId) {
          pendingPermission.value = null
        }
        return
      case 'status':
        isLoading.value = event.isLoading
        spinnerVerb.value = event.isLoading ? (event.spinnerVerb ?? null) : null
        return
      case 'error':
        error.value = event.message ?? t.errors.server
        return
      case 'sessions':
        sessions.value = event.sessions ?? []
        return
      case 'session_gone':
        if (selectedSessionId.value === event.sessionId) {
          selectedSessionId.value = ''
          messages.value = []
          pendingPermission.value = null
          sessionInfo.value = null
          isLoading.value = false
        }
        return
      default:
        return
    }
  }

  function send(event: ClientEvent): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify(event))
      return true
    } catch {
      return false
    }
  }

  function connect(url: string, token: string) {
    if (!url.trim() || !token.trim()) {
      error.value = t.connect.errorRequired
      connectionState.value = 'error'
      return
    }
    // Replacing the current session — reset everything first.
    explicitlyClosed = true
    if (ws) {
      try { ws.close(1000, 'replace') } catch { /* noop */ }
      ws = null
    }
    clearTimers()

    desiredUrl = url.trim()
    desiredToken = token.trim()
    currentUrl.value = desiredUrl
    messages.value = []
    pendingPermission.value = null
    sessionInfo.value = null
    isLoading.value = false
    backoff = INITIAL_BACKOFF_MS
    explicitlyClosed = false

    openSocket()
  }

  function disconnect() {
    explicitlyClosed = true
    clearTimers()
    if (ws) {
      try { ws.close(1000, 'client-disconnect') } catch { /* noop */ }
      ws = null
    }
    connectionState.value = 'disconnected'
  }

  function selectSession(sessionId: string) {
    selectedSessionId.value = sessionId
    messages.value = []
    pendingPermission.value = null
    sessionInfo.value = null
    isLoading.value = false
    send({ type: 'select_session', sessionId })
  }

  function sendPrompt(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    return send({ type: 'prompt', text: trimmed })
  }

  function respondToPermission(
    requestId: string,
    behavior: PermissionBehavior,
    message?: string,
  ): boolean {
    const ok = send({ type: 'permission_response', requestId, behavior, message })
    if (ok && pendingPermission.value?.requestId === requestId) {
      pendingPermission.value = null
    }
    return ok
  }

  return {
    connectionState,
    isLoading,
    spinnerVerb,
    messages,
    pendingPermission,
    error,
    sessionInfo,
    currentUrl,
    sessions,
    selectedSessionId,
    connect,
    disconnect,
    sendPrompt,
    selectSession,
    respondToPermission,
  }
}

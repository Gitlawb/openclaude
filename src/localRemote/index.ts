/**
 * Public entry point for the local-remote bridge.
 *
 * In daemon mode, Neural Network sessions (workers) connect outbound to a
 * standalone daemon process that holds the HTTP+WS port. The daemon
 * routes messages between workers and browser clients and exposes
 * `/api/sessions` for session discovery.
 *
 * Commands and the REPL import from here. Internal modules should not
 * be imported directly outside this directory.
 */

import { networkInterfaces } from 'node:os'
import { logForDebugging } from '../utils/debug.js'
import {
  buildPermissionRequest,
} from './localRemoteBridge.js'
import {
  loadLocalRemoteSettings,
  rotateLocalRemoteToken,
  tokenPreview,
} from './localRemoteConfig.js'
import * as events from './localRemoteEvents.js'
import { getSpinnerVerbs } from '../constants/spinnerVerbs.js'
import {
  registerPermissionSettler,
  setPromptSubmitter,
  unregisterPermissionSettler,
  type PermissionSettler,
  type PromptSubmitter,
} from './sessionRegistry.js'
import type { ServerStatus, StartResult } from './types.js'
import {
  createWorkerConnection,
  type WorkerConnectionHandle,
} from './workerConnection.js'
import { autoSpawnDaemon } from './daemon/autoSpawn.js'

let workerConn: WorkerConnectionHandle | null = null

/** Read-only snapshot used by the /remote command. */
export function getStatus(): ServerStatus {
  const settings = loadLocalRemoteSettings()
  if (!workerConn) return { running: false }
  return {
    running: true,
    url: buildUrl('http', settings.host, settings.port),
    lanUrl: buildLanUrl(settings.host, settings.port),
    port: settings.port,
    host: settings.host,
    tokenPreview: tokenPreview(settings.token),
    connectedToDaemon: workerConn.isConnected(),
    sessionCount: workerConn.sessionCount,
  }
}

export async function startLocalRemote(overrides?: {
  port?: number
  host?: string
}): Promise<StartResult> {
  if (workerConn) {
    const settings = loadLocalRemoteSettings()
    const port = overrides?.port ?? settings.port
    const host = overrides?.host ?? settings.host
    return {
      url: buildUrl('http', host, port),
      lanUrl: buildLanUrl(host, port),
      token: settings.token,
      port,
      host,
    }
  }

  const settings = loadLocalRemoteSettings()
  const port = overrides?.port ?? settings.port
  const host = overrides?.host ?? settings.host
  const token = settings.token

  // Ensure daemon is running (auto-spawn if needed).
  const daemonReady = await autoSpawnDaemon()
  if (!daemonReady) {
    throw new Error(
      `Could not reach or start the remote daemon on ${host}:${port}. ` +
      `Try starting it manually: openclaude remote-daemon`
    )
  }

  const daemonHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  workerConn = createWorkerConnection({
    daemonUrl: `ws://${daemonHost}:${port}`,
    token,
    cwd: process.cwd(),
    title: `Neural Network @ ${process.cwd()}`,
  })

  logForDebugging(`[localRemote] connected to daemon at ${daemonHost}:${port}`)
  return {
    url: buildUrl('http', host, port),
    lanUrl: buildLanUrl(host, port),
    token,
    port,
    host,
  }
}

export async function stopLocalRemote(): Promise<void> {
  if (!workerConn) return
  const conn = workerConn
  workerConn = null
  conn.dispose()
}

/** Перезапустити демон remote-сесії. Зупиняє поточний демон, запускає новий та перепідключає worker. */
export async function reloadLocalRemote(): Promise<void> {
  // Зберегти стан підключення
  const wasConnected = workerConn !== null

  // Зупинити worker-з'єднання
  if (wasConnected) {
    await stopLocalRemote()
  }

  // Зупинити демон (якщо він запущений)
  try {
    // Перевірити, чи демон запущений, перед спробою зупинки
    const { readAliveDaemonPid } = await import('./daemon/pidLock.js')
    const pid = readAliveDaemonPid()
    if (pid) {
      // Демон запущений - зупинити його
      const { handleDaemonStop } = await import('./daemon/main.js')
      handleDaemonStop()
      // Дати демону час на завершення
      await new Promise(resolve => setTimeout(resolve, 1000))
    } else {
      logForDebugging('[localRemote] демон не запущений, переходимо до перезапуску')
    }
  } catch (err) {
    // Якщо не вдалося зупинити демон, все одно спробуємо перезапустити
    logForDebugging(`[localRemote] помилка при зупинці демона: ${err}`)
  }

  // Перезапустити демон
  const daemonReady = await autoSpawnDaemon()
  if (!daemonReady) {
    throw new Error('Не вдалося перезапустити демон. Спробуйте запустити вручну: openclaude remote-daemon')
  }

  // Перепідключити worker, якщо він був підключений
  if (wasConnected) {
    await startLocalRemote()
  }
}

export function rotateToken(): string {
  const newToken = rotateLocalRemoteToken()
  return newToken
}

export function isLocalRemoteRunning(): boolean {
  return workerConn !== null
}

// ─── Session-side hook API ────────────────────────────────────────────────

/**
 * REPL.tsx calls this once the session is ready to receive prompts
 * programmatically. Returns an unregister fn.
 */
export function setRemoteSubmitter(fn: PromptSubmitter | null): () => void {
  setPromptSubmitter(fn)
  return () => setPromptSubmitter(null)
}

/** Emit a message list change so the bridge can broadcast to clients. */
export function publishMessages(
  messages: Parameters<typeof events.emit<'messagesChanged'>>[1],
): void {
  if (!workerConn) return
  events.emit('messagesChanged', messages)
}

/** Emit a loading-state change. Picks a random spinner verb when loading starts. */
export function publishLoading(isLoading: boolean, spinnerVerb?: string): void {
  if (!workerConn) return
  const verb = isLoading
    ? (spinnerVerb ?? pickRandomVerb())
    : undefined
  events.emit('loadingChanged', isLoading, verb)
}

function pickRandomVerb(): string {
  const verbs = getSpinnerVerbs()
  return verbs[Math.floor(Math.random() * verbs.length)] ?? verbs[0] ?? 'Думаємо'
}

/** Emit a pending permission request. */
export function publishPendingPermission(
  toolName: string,
  opts: { requestId?: string; description?: string; input?: unknown },
  settler: PermissionSettler,
): string {
  const req = buildPermissionRequest(toolName, opts)
  registerPermissionSettler(req.requestId, settler)
  if (workerConn) {
    events.emit('permissionPending', req)
  }
  return req.requestId
}

/**
 * Emit that a pending permission was resolved (locally or remotely).
 *
 * Зміна: додатково знімаємо settler із sessionRegistry. Без цього при
 * локальному розв'язанні запиту settler залишався у глобальній мапі, і
 * наступна (помилково пізня) відповідь із браузера могла спрацювати
 * повторно — або ж settler просто "висів" до наступного settlePermission.
 */
export function publishResolvedPermission(requestId: string): void {
  unregisterPermissionSettler(requestId)
  if (!workerConn) return
  events.emit('permissionResolved', requestId)
}

export { tokenPreview, rotateLocalRemoteToken, reloadLocalRemote }

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildUrl(scheme: 'http' | 'https', host: string, port: number): string {
  const display = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  return `${scheme}://${display}:${port}`
}

function buildLanUrl(host: string, port: number): string | undefined {
  if (host !== '0.0.0.0' && host !== '::') return undefined
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        return `http://${info.address}:${port}`
      }
    }
  }
  return undefined
}

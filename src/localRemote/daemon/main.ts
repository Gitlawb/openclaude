/**
 * Entry point for the remote daemon process.
 *
 * Can be invoked in two ways:
 *   1. CLI: `openclaude remote-daemon [--stop|--status]`
 *   2. Auto-spawn: detached child process started by a worker.
 *
 * The daemon holds the HTTP+WS port and routes messages between
 * Neural Network worker processes and browser clients.
 */

import { loadLocalRemoteSettings, tokenPreview } from '../localRemoteConfig.js'
import { createDaemonServer, type DaemonServerHandle } from './daemonServer.js'
import { acquirePidLock, readAliveDaemonPid, releasePidLock } from './pidLock.js'
import { networkInterfaces } from 'node:os'

function buildUrl(host: string, port: number): string {
  const display = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  return `http://${display}:${port}`
}

function getLanUrl(host: string, port: number): string | undefined {
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

/**
 * Handle `--stop`: send SIGTERM to the running daemon.
 */
export function handleDaemonStop(): void {
  const pid = readAliveDaemonPid()
  if (!pid) {
    console.log('No running daemon found.')
    process.exit(1)
  }
  try {
    process.kill(pid, 'SIGTERM')
    console.log(`Sent SIGTERM to daemon (PID ${pid}).`)
  } catch (err) {
    console.error(`Failed to stop daemon (PID ${pid}):`, err)
    process.exit(1)
  }
}

/**
 * Handle `--status`: print daemon info.
 */
export async function handleDaemonStatus(): Promise<void> {
  const settings = loadLocalRemoteSettings()
  const pid = readAliveDaemonPid()
  if (!pid) {
    console.log('Daemon: not running.')
    return
  }

  const url = buildUrl(settings.host, settings.port)
  try {
    const resp = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) })
    const data = await resp.json() as { ok?: boolean; role?: string; sessions?: number }
    console.log(`Daemon: running (PID ${pid})`)
    console.log(`  URL:      ${url}`)
    const lan = getLanUrl(settings.host, settings.port)
    if (lan) console.log(`  LAN:      ${lan}`)
    console.log(`  Token:    ${tokenPreview(settings.token)}`)
    console.log(`  Sessions: ${data.sessions ?? '?'}`)
  } catch {
    console.log(`Daemon: PID ${pid} alive but /healthz unreachable at ${url}.`)
  }
}

/**
 * Run the daemon in foreground (blocking). Used by both CLI and auto-spawn.
 */
export async function runDaemon(): Promise<void> {
  if (!acquirePidLock()) {
    const existingPid = readAliveDaemonPid()
    if (existingPid) {
      console.error(`Daemon already running (PID ${existingPid}).`)
      process.exit(1)
    }
    // Stale lock was cleaned by acquirePidLock; try once more.
    if (!acquirePidLock()) {
      console.error('Could not acquire PID lock.')
      process.exit(1)
    }
  }

  const settings = loadLocalRemoteSettings()
  let server: DaemonServerHandle

  try {
    server = await createDaemonServer({
      port: settings.port,
      host: settings.host,
      token: settings.token,
    })
  } catch (err) {
    releasePidLock()
    throw err
  }

  const url = buildUrl(settings.host, settings.port)
  const lan = getLanUrl(settings.host, settings.port)
  console.log(`Remote daemon listening.`)
  console.log(`  URL:   ${url}`)
  if (lan) console.log(`  LAN:   ${lan}`)
  console.log(`  Token: ${tokenPreview(settings.token)}`)
  console.log(`  PID:   ${process.pid}`)

  const shutdown = async () => {
    console.log('\nDaemon stopping…')
    await server.close()
    releasePidLock()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  // Keep the process alive. The HTTP server already does this, but
  // being explicit helps understanding.
  const keepAlive = setInterval(() => {}, 60_000)
  keepAlive.unref?.() // Don't prevent exit if server is closed elsewhere.
}

/**
 * CLI dispatcher for `openclaude remote-daemon [--stop|--status]`.
 */
export async function remoteDaemonCli(args: string[]): Promise<void> {
  const arg = args[0]?.replace(/^-+/, '').toLowerCase() ?? ''

  if (arg === 'stop') {
    handleDaemonStop()
    return
  }
  if (arg === 'status') {
    await handleDaemonStatus()
    return
  }

  // Default: run daemon in foreground.
  await runDaemon()
}

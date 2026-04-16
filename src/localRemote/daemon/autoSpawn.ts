/**
 * Auto-spawn the remote daemon as a detached background process.
 *
 * Called by workers when `/remote on` finds no running daemon.
 * Uses a PID lock to prevent multiple workers from racing.
 */

import { spawn } from 'node:child_process'
import { loadLocalRemoteSettings } from '../localRemoteConfig.js'
import { acquirePidLock, readAliveDaemonPid } from './pidLock.js'

/**
 * Attempt to start the daemon in the background.
 * Returns true if the daemon became reachable within the timeout.
 */
export async function autoSpawnDaemon(): Promise<boolean> {
  // Check if daemon is already running.
  const existingPid = readAliveDaemonPid()
  if (existingPid) {
    // Daemon exists — just verify it's reachable.
    return await probeDaemon(300)
  }

  // Try to claim the PID lock — if we lose the race, another worker
  // is already spawning. Just wait for it.
  const gotLock = acquirePidLock()
  if (!gotLock) {
    // Someone else is spawning. Wait for it to become reachable.
    return await probeDaemon(3000)
  }

  // We won the race. Spawn daemon as detached child.
  // The daemon process itself will write its PID into the lock file
  // (overwriting ours) once it starts listening. We release our
  // temporary lock first so the daemon can re-acquire it.
  const { releasePidLock } = await import('./pidLock.js')
  releasePidLock()

  try {
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1]!, 'remote-daemon'],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      },
    )
    child.unref()
  } catch {
    return false
  }

  // Poll /healthz until the daemon is ready (up to 3 seconds).
  return await probeDaemon(3000)
}

/**
 * Probe the daemon's /healthz endpoint with retries.
 */
async function probeDaemon(timeoutMs: number): Promise<boolean> {
  const settings = loadLocalRemoteSettings()
  const host = settings.host === '0.0.0.0' || settings.host === '::' ? '127.0.0.1' : settings.host
  const url = `http://${host}:${settings.port}/healthz`
  const deadline = Date.now() + timeoutMs
  const interval = 200

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(500) })
      if (resp.ok) {
        const data = await resp.json() as { role?: string }
        if (data.role === 'daemon') return true
      }
    } catch {
      // Not yet ready.
    }
    await new Promise(r => setTimeout(r, interval))
  }
  return false
}

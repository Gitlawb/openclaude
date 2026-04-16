/**
 * Atomic PID file locking for the remote daemon.
 *
 * Uses `O_CREAT | O_EXCL` for atomic creation. On startup the daemon
 * checks whether the PID in the file is still alive (signal 0); if not,
 * the stale file is removed and a fresh lock is taken.
 */

import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { constants } from 'node:fs'

const PID_FILE_NAME = 'remote-daemon.pid'

function pidFilePath(): string {
  return join(homedir(), '.claude', PID_FILE_NAME)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Read the PID from the lock file and return it if the process is alive.
 * Returns null if no lock exists or the process is dead (stale lock removed).
 */
export function readAliveDaemonPid(): number | null {
  const path = pidFilePath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8').trim()
  } catch {
    return null
  }
  const pid = parseInt(raw, 10)
  if (Number.isNaN(pid) || pid <= 0) {
    // Corrupt file — remove it.
    try { unlinkSync(path) } catch { /* noop */ }
    return null
  }
  if (!isProcessAlive(pid)) {
    try { unlinkSync(path) } catch { /* noop */ }
    return null
  }
  return pid
}

/**
 * Try to acquire the PID lock file atomically.
 * Returns true if lock was acquired (caller wrote PID), false if already held.
 */
export function acquirePidLock(): boolean {
  const path = pidFilePath()

  // Clean stale lock first.
  readAliveDaemonPid()

  let fd: number
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL)
  } catch {
    // File exists — another process won the race.
    return false
  }
  try {
    writeFileSync(fd, String(process.pid))
  } finally {
    closeSync(fd)
  }
  return true
}

/**
 * Release the PID lock file. Only removes if the PID matches ours.
 */
export function releasePidLock(): void {
  const path = pidFilePath()
  try {
    const raw = readFileSync(path, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    if (pid === process.pid) {
      unlinkSync(path)
    }
  } catch {
    // File already gone or unreadable — nothing to do.
  }
}

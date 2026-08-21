import { randomUUID } from 'node:crypto'
import {
  mkdirSync as mkdirExclusiveSync,
  renameSync as renameLockSync,
  rmSync as removeLockSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../file.js'
import {
  getFsImplementation,
  resolveDeepestExistingAncestorSync,
} from '../fsOperations.js'
import { markInternalWrite } from './internalWrites.js'
import { resetSettingsCache } from './settingsCache.js'

const SETTINGS_LOCK_RETRY_MS = 25
const SETTINGS_LOCK_CONTENTION_LOG_MS = 100
const SETTINGS_LOCK_WAIT_MS = 2_000
const SETTINGS_LOCK_HOST = hostname()
const SETTINGS_LOCK_OWNER_FILE = 'owner.json'
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

type SettingsLockIdentity = {
  version: 1
  host: string
  pid: number
  token: string
}

type SettingsLockIdentityRead =
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'valid'; identity: SettingsLockIdentity }

function sameIdentity(
  left: SettingsLockIdentity,
  right: SettingsLockIdentity,
): boolean {
  return (
    left.version === right.version &&
    left.host === right.host &&
    left.pid === right.pid &&
    left.token === right.token
  )
}

function readLockIdentity(lockPath: string): SettingsLockIdentityRead {
  let raw: string
  try {
    raw = getFsImplementation().readFileSync(
      join(lockPath, SETTINGS_LOCK_OWNER_FILE),
      { encoding: 'utf8' },
    )
  } catch (error) {
    if (getErrnoCode(error) !== 'ENOENT') return { state: 'invalid' }
    try {
      getFsImplementation().lstatSync(lockPath)
      return { state: 'invalid' }
    } catch (lockError) {
      return getErrnoCode(lockError) === 'ENOENT'
        ? { state: 'missing' }
        : { state: 'invalid' }
    }
  }

  try {
    const candidate = JSON.parse(raw) as Partial<SettingsLockIdentity>
    if (
      candidate.version !== 1 ||
      typeof candidate.host !== 'string' ||
      candidate.host.length === 0 ||
      candidate.host.length > 255 ||
      !Number.isSafeInteger(candidate.pid) ||
      (candidate.pid ?? 0) <= 0 ||
      typeof candidate.token !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        candidate.token,
      )
    ) {
      return { state: 'invalid' }
    }
    return {
      state: 'valid',
      identity: candidate as SettingsLockIdentity,
    }
  } catch {
    return { state: 'invalid' }
  }
}

function createLockIdentity(): SettingsLockIdentity {
  return {
    version: 1,
    host: SETTINGS_LOCK_HOST,
    pid: process.pid,
    token: randomUUID(),
  }
}

function isIdentityOwnerAlive(identity: SettingsLockIdentity): boolean {
  // A different host may share this filesystem, but its process namespace is
  // not observable here. Never reclaim that ownership on local PID evidence.
  if (identity.host !== SETTINGS_LOCK_HOST) return true
  try {
    process.kill(identity.pid, 0)
    return true
  } catch (error) {
    return getErrnoCode(error) !== 'ESRCH'
  }
}

function tryCreateOwnedLock(
  lockPath: string,
  owner: SettingsLockIdentity,
): boolean {
  try {
    mkdirExclusiveSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if (getErrnoCode(error) === 'EEXIST') return false
    try {
      getFsImplementation().lstatSync(lockPath)
      return false
    } catch (statError) {
      if (getErrnoCode(statError) !== 'ENOENT') throw statError
      throw error
    }
  }

  try {
    writeFileSyncAndFlush_DEPRECATED(
      join(lockPath, SETTINGS_LOCK_OWNER_FILE),
      JSON.stringify(owner),
      { encoding: 'utf8', mode: 0o600 },
    )
    return true
  } catch (error) {
    removeLockSync(lockPath, { recursive: true, force: true })
    throw error
  }
}

function recoveredLockPath(
  lockPath: string,
  owner: SettingsLockIdentity,
): string {
  return `${lockPath}.recovered.${owner.pid}.${owner.token}`
}

function tryRecoverDeadLock(
  lockPath: string,
  expectedOwner: SettingsLockIdentity,
): boolean {
  const recoveredPath = recoveredLockPath(lockPath, expectedOwner)
  try {
    renameLockSync(lockPath, recoveredPath)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT' || code === 'EEXIST' || code === 'ENOTEMPTY') {
      return false
    }
    if (code === 'EPERM') {
      try {
        getFsImplementation().lstatSync(recoveredPath)
        return false
      } catch (statError) {
        if (getErrnoCode(statError) !== 'ENOENT') throw statError
      }
    }
    throw error
  }

  const recoveredOwner = readLockIdentity(recoveredPath)
  if (
    recoveredOwner.state !== 'valid' ||
    !sameIdentity(recoveredOwner.identity, expectedOwner)
  ) {
    throw Object.assign(
      new Error('Settings file lock changed during dead-owner recovery'),
      { code: 'ECOMPROMISED' },
    )
  }

  // Keep the deterministic non-empty tombstone. A contender that read this
  // dead owner before the rename can only target the same path, so rename will
  // refuse to replace the tombstone instead of moving a successor's live lock.
  logForDebugging(
    `Recovered settings file lock from exited process ${expectedOwner.pid}`,
    { level: 'warn' },
  )
  return true
}

function tryAcquireSettingsLock(
  lockPath: string,
  owner: SettingsLockIdentity,
): boolean {
  if (tryCreateOwnedLock(lockPath, owner)) return true

  const currentOwner = readLockIdentity(lockPath)
  if (
    currentOwner.state !== 'valid' ||
    isIdentityOwnerAlive(currentOwner.identity)
  ) {
    return false
  }

  if (!tryRecoverDeadLock(lockPath, currentOwner.identity)) return false
  return tryCreateOwnedLock(lockPath, owner)
}

function releaseOwnedLock(
  lockPath: string,
  owner: SettingsLockIdentity,
): void {
  const currentOwner = readLockIdentity(lockPath)
  if (
    currentOwner.state !== 'valid' ||
    !sameIdentity(currentOwner.identity, owner)
  ) {
    throw Object.assign(
      new Error('Settings file lock ownership changed before release'),
      { code: 'ECOMPROMISED' },
    )
  }
  removeLockSync(lockPath, { recursive: true })
}

function describeCurrentOwner(lockPath: string): string {
  const currentOwner = readLockIdentity(lockPath)
  if (currentOwner.state !== 'valid') return 'an unknown owner'
  return `${currentOwner.identity.host} process ${currentOwner.identity.pid}`
}

function resolveSettingsMutationTarget(requestedPath: string): string {
  const fs = getFsImplementation()
  const absolutePath = resolve(requestedPath)
  try {
    return fs.realpathSync(absolutePath)
  } catch (error) {
    if (getErrnoCode(error) !== 'ENOENT') throw error
    return (
      resolveDeepestExistingAncestorSync(fs, absolutePath) ?? absolutePath
    )
  }
}

function acquireSettingsLock(targetPath: string): () => void {
  const lockPath = `${targetPath}.lock`
  const owner = createLockIdentity()
  const startedAt = performance.now()
  const deadline = startedAt + SETTINGS_LOCK_WAIT_MS
  let reportedContention = false

  while (true) {
    if (tryAcquireSettingsLock(lockPath, owner)) {
      return () => releaseOwnedLock(lockPath, owner)
    }

    const now = performance.now()
    const elapsed = now - startedAt
    if (!reportedContention && elapsed >= SETTINGS_LOCK_CONTENTION_LOG_MS) {
      reportedContention = true
      logForDebugging(
        `Settings file lock contention has lasted ${Math.round(elapsed)}ms`,
        { level: 'warn' },
      )
    }
    const remaining = deadline - now
    if (remaining <= 0) {
      throw Object.assign(
        new Error(
          `Timed out after ${SETTINGS_LOCK_WAIT_MS}ms waiting for settings lock ${lockPath}, held by ${describeCurrentOwner(lockPath)}. If that process is known to have exited, remove the lock directory before retrying.`,
        ),
        { code: 'ELOCKED' },
      )
    }
    Atomics.wait(
      waitBuffer,
      0,
      0,
      Math.min(SETTINGS_LOCK_RETRY_MS, remaining),
    )
  }
}

/**
 * Run one synchronous settings-file operation under its physical-target lock.
 * Calls for the same target must not be nested; contention remains bounded by
 * the normal acquisition deadline.
 */
export function withSettingsFileTransactionSync<T>(
  requestedPath: string,
  operation: (targetPath: string) => T,
): T {
  const targetPath = resolveSettingsMutationTarget(requestedPath)
  getFsImplementation().mkdirSync(dirname(targetPath))
  const release = acquireSettingsLock(targetPath)
  let operationFailed = false
  try {
    return operation(targetPath)
  } catch (error) {
    operationFailed = true
    throw error
  } finally {
    try {
      release()
    } catch (releaseError) {
      if (!operationFailed) throw releaseError
      logForDebugging(`Settings lock release failed: ${releaseError}`, {
        level: 'error',
      })
    }
  }
}

/** Replace a complete settings document using the shared transaction identity. */
export function replaceSettingsFileSync(
  requestedPath: string,
  content: string,
): void {
  withSettingsFileTransactionSync(requestedPath, targetPath => {
    writeFileSyncAndFlush_DEPRECATED(targetPath, content)
    markInternalWrite(requestedPath)
    resetSettingsCache()
  })
}

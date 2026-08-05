import { randomUUID } from 'crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  writeFileSync,
} from 'fs'
import { dirname, join, resolve } from 'path'
import { logForDebugging } from '../debug.js'
import { getErrnoCode, toError } from '../errors.js'
import {
  getFsImplementation,
  resolveDeepestExistingAncestorSync,
  safeResolvePath,
} from '../fsOperations.js'
import * as lockfile from '../lockfile.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../file.js'
import { markInternalWrite } from './internalWrites.js'
import { resetSettingsCache } from './settingsCache.js'

const SETTINGS_LOCK_STALE_MS = Number.MAX_SAFE_INTEGER
const SETTINGS_LOCK_UPDATE_MS = 60_000
const SETTINGS_LOCK_OWNER_MAX_BYTES = 1_024

type SettingsLockOwner = {
  pid: number
  token: string
}

type LockIdentity = {
  dev: number
  ino: number
  birthtimeMs: number
}

export type SettingsFileLockContext = {
  targetPath: string
  assertOwned(): void
}

function getSettingsLockPaths(targetPath: string): {
  lockPath: string
  ownerPath: string
} {
  const lockPath = `${targetPath}.lock`
  return { lockPath, ownerPath: join(lockPath, 'owner.json') }
}

function readOwner(ownerPath: string): SettingsLockOwner | null {
  let fd: number | undefined
  try {
    const pathStats = lstatSync(ownerPath)
    if (
      !pathStats.isFile() ||
      pathStats.isSymbolicLink() ||
      pathStats.size <= 0 ||
      pathStats.size > SETTINGS_LOCK_OWNER_MAX_BYTES
    ) {
      return null
    }

    const unixSafetyFlags =
      process.platform === 'win32'
        ? 0
        : (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    fd = openSync(ownerPath, constants.O_RDONLY | unixSafetyFlags)
    const fileStats = fstatSync(fd)
    if (
      !fileStats.isFile() ||
      fileStats.dev !== pathStats.dev ||
      fileStats.ino !== pathStats.ino ||
      fileStats.birthtimeMs !== pathStats.birthtimeMs ||
      fileStats.size !== pathStats.size
    ) {
      return null
    }

    const buffer = Buffer.alloc(fileStats.size)
    let offset = 0
    while (offset < buffer.length) {
      const bytesRead = readSync(
        fd,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== buffer.length) {
      return null
    }

    const raw = buffer.toString('utf8')
    const parsed = jsonParse(raw) as Partial<SettingsLockOwner>
    return Number.isSafeInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      parsed.token.length <= 128
      ? { pid: parsed.pid!, token: parsed.token }
      : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // The owner is treated as unreadable above; close errors are not useful.
      }
    }
  }
}

function writeOwner(ownerPath: string, owner: SettingsLockOwner): void {
  writeFileSync(ownerPath, jsonStringify(owner), {
    encoding: 'utf8',
    flag: 'wx',
    flush: true,
    mode: 0o600,
  })
}

function isProcessDead(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    // Only ESRCH demonstrates that no such process exists. EPERM and argument,
    // range, or platform errors are unknown and must fail closed.
    return getErrnoCode(error) === 'ESRCH'
  }
}

function readLockIdentity(lockPath: string): LockIdentity | null {
  try {
    const stats = getFsImplementation().lstatSync(lockPath)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return null
    }
    return {
      dev: stats.dev,
      ino: stats.ino,
      birthtimeMs: stats.birthtimeMs,
    }
  } catch {
    return null
  }
}

function lockIdentityMatches(
  left: LockIdentity | null,
  right: LockIdentity,
): boolean {
  return (
    left !== null &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs
  )
}

function ownersMatch(
  left: SettingsLockOwner | null,
  right: SettingsLockOwner,
): boolean {
  return (
    left !== null &&
    left.pid === right.pid &&
    left.token === right.token
  )
}

function pathIsAbsent(path: string): boolean {
  try {
    lstatSync(path)
    return false
  } catch (error) {
    return getErrnoCode(error) === 'ENOENT'
  }
}

function claimRecoveryPath(
  lockPath: string,
  identity: LockIdentity,
  ownerPath: string,
  owner: SettingsLockOwner,
  recoveryPath: string,
  recoveryOwner: SettingsLockOwner,
): boolean {
  const fs = getFsImplementation()
  try {
    writeOwner(recoveryPath, recoveryOwner)
    return true
  } catch (error) {
    if (getErrnoCode(error) !== 'EEXIST') {
      throw error
    }
  }

  // Staleness is intentionally disabled for settings locks, so a recovery
  // claim left by a confirmed-dead process must itself be recoverable.
  const existingClaim = readOwner(recoveryPath)
  if (!existingClaim || !isProcessDead(existingClaim.pid)) {
    return false
  }
  if (
    !ownersMatch(readOwner(ownerPath), owner) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity) ||
    !ownersMatch(readOwner(recoveryPath), existingClaim)
  ) {
    return false
  }

  try {
    fs.unlinkSync(recoveryPath)
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') {
      return false
    }
    throw error
  }

  // Revalidate the dead lock after removing the orphan. If another contender
  // changed it, leave the path unclaimed and let a later acquisition retry.
  if (
    !ownersMatch(readOwner(ownerPath), owner) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity)
  ) {
    return false
  }

  try {
    writeOwner(recoveryPath, recoveryOwner)
    return true
  } catch (error) {
    if (getErrnoCode(error) === 'EEXIST') {
      return false
    }
    throw error
  }
}

function removeOwnerlessRecoveryLock(
  lockPath: string,
  identity: LockIdentity,
  ownerPath: string,
): boolean {
  const fs = getFsImplementation()
  const recoveryPath = join(lockPath, 'recovery.json')
  const recoveryOwner = readOwner(recoveryPath)
  if (!recoveryOwner || !isProcessDead(recoveryOwner.pid)) {
    return false
  }
  if (
    !pathIsAbsent(ownerPath) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity) ||
    !ownersMatch(readOwner(recoveryPath), recoveryOwner)
  ) {
    return false
  }

  try {
    fs.unlinkSync(recoveryPath)
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') {
      return false
    }
    throw error
  }

  // The previous recoverer had already removed owner.json. Remove only the
  // same directory after confirming no owner appeared in the meantime.
  if (
    !pathIsAbsent(ownerPath) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity)
  ) {
    return false
  }

  try {
    fs.rmdirSync(lockPath)
    return true
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT' && !fs.existsSync(lockPath)) {
      return true
    }
    // Preserve a recoverable claim if the directory could not be removed.
    try {
      if (
        pathIsAbsent(ownerPath) &&
        pathIsAbsent(recoveryPath) &&
        lockIdentityMatches(readLockIdentity(lockPath), identity)
      ) {
        writeOwner(recoveryPath, recoveryOwner)
      }
    } catch {
      // The original cleanup error is the useful one.
    }
    throw error
  }
}

function removeDeadOwnerLock(
  lockPath: string,
  ownerPath: string,
): boolean {
  const fs = getFsImplementation()
  const identity = readLockIdentity(lockPath)
  if (!identity) {
    return false
  }
  const owner = readOwner(ownerPath)
  if (!owner) {
    return removeOwnerlessRecoveryLock(lockPath, identity, ownerPath)
  }
  if (!isProcessDead(owner.pid)) {
    return false
  }

  // Only one contender may recover this dead directory. Without this
  // exclusive claim, a delayed contender can unlink the owner metadata from a
  // replacement lock created by the first recovery winner.
  const recoveryPath = join(lockPath, 'recovery.json')
  const recoveryOwner: SettingsLockOwner = {
    pid: process.pid,
    token: randomUUID(),
  }
  if (
    !claimRecoveryPath(
      lockPath,
      identity,
      ownerPath,
      owner,
      recoveryPath,
      recoveryOwner,
    )
  ) {
    return false
  }

  const releaseRecoveryClaim = (): void => {
    if (ownersMatch(readOwner(recoveryPath), recoveryOwner)) {
      fs.unlinkSync(recoveryPath)
    }
  }

  // Re-read immediately before cleanup so a concurrent recovery winner's
  // metadata is never removed using the stale snapshot above.
  const current = readOwner(ownerPath)
  if (
    !ownersMatch(current, owner) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity) ||
    !ownersMatch(readOwner(recoveryPath), recoveryOwner)
  ) {
    releaseRecoveryClaim()
    return false
  }

  try {
    fs.unlinkSync(ownerPath)
    releaseRecoveryClaim()
    fs.rmdirSync(lockPath)
    return true
  } catch (error) {
    // If removing the directory failed, restore the metadata when possible so
    // a later contender can still make the same conservative liveness check.
    try {
      if (fs.existsSync(lockPath) && !fs.existsSync(ownerPath)) {
        writeOwner(ownerPath, owner)
      }
    } catch {
      // The original cleanup error is the useful one.
    }
    try {
      releaseRecoveryClaim()
    } catch {
      // Preserve the original cleanup error.
    }
    if (getErrnoCode(error) === 'ENOENT' && !fs.existsSync(lockPath)) {
      return true
    }
    throw error
  }
}

export function resolveSettingsFileTarget(filePath: string): string {
  const fs = getFsImplementation()
  let targetPath = resolve(filePath)

  // A dangling final symlink can yield another non-canonical path, especially
  // when its parent is itself reached through an alias. Resolve repeatedly so
  // the symlink target and then its deepest existing parent are canonicalized.
  const visited = new Set<string>()
  for (let depth = 0; depth < 64; depth++) {
    if (visited.has(targetPath)) {
      throw new Error(`Cyclic settings symlink target at ${targetPath}`)
    }
    visited.add(targetPath)

    const resolved = safeResolvePath(fs, targetPath)
    if (resolved.isCanonical) {
      return resolved.resolvedPath
    }
    const next = resolveDeepestExistingAncestorSync(fs, targetPath)
    if (!next || next === targetPath) {
      return targetPath
    }
    targetPath = next
  }

  throw new Error(`Settings symlink depth exceeded for ${filePath}`)
}

function acquireSettingsFileLock(filePath: string): {
  context: SettingsFileLockContext
  release(): void
} {
  const fs = getFsImplementation()
  fs.mkdirSync(dirname(filePath))

  const targetPath = resolveSettingsFileTarget(filePath)
  const { lockPath, ownerPath } = getSettingsLockPaths(targetPath)
  const owner: SettingsLockOwner = {
    pid: process.pid,
    token: randomUUID(),
  }
  let compromisedError: Error | null = null

  const attempt = (): (() => void) =>
    lockfile.lockSync(targetPath, {
      lockfilePath: lockPath,
      onCompromised: error => {
        compromisedError = toError(error)
        logForDebugging(`Settings lock compromised: ${error}`, {
          level: 'error',
        })
      },
      realpath: false,
      stale: SETTINGS_LOCK_STALE_MS,
      update: SETTINGS_LOCK_UPDATE_MS,
    })

  let releaseLock: () => void
  try {
    releaseLock = attempt()
  } catch (error) {
    if (
      getErrnoCode(error) !== 'ELOCKED' ||
      !removeDeadOwnerLock(lockPath, ownerPath)
    ) {
      throw error
    }
    releaseLock = attempt()
  }

  let identity: LockIdentity
  try {
    writeOwner(ownerPath, owner)
    const acquiredIdentity = readLockIdentity(lockPath)
    if (!acquiredIdentity) {
      throw new Error('Settings lock path is not a directory')
    }
    identity = acquiredIdentity
  } catch (error) {
    try {
      fs.unlinkSync(ownerPath)
    } catch {
      // Owner metadata may not have been created yet.
    }
    try {
      releaseLock()
    } catch {
      // Preserve the owner-write/stat failure.
    }
    throw error
  }

  const assertOwned = (): void => {
    if (compromisedError) {
      throw new Error(`Settings lock was compromised: ${compromisedError}`)
    }
    const currentOwner = readOwner(ownerPath)
    if (
      !currentOwner ||
      currentOwner.pid !== owner.pid ||
      currentOwner.token !== owner.token ||
      !lockIdentityMatches(readLockIdentity(lockPath), identity)
    ) {
      throw new Error('Settings lock ownership changed during update')
    }
  }

  let released = false
  return {
    context: { targetPath, assertOwned },
    release(): void {
      if (released) return
      assertOwned()
      fs.unlinkSync(ownerPath)
      try {
        releaseLock()
        released = true
      } catch (error) {
        try {
          if (fs.existsSync(lockPath) && !fs.existsSync(ownerPath)) {
            writeOwner(ownerPath, owner)
          }
        } catch {
          // Keep the release failure as the returned error.
        }
        throw error
      }
    },
  }
}

export function withSettingsFileLockSync<T>(
  filePath: string,
  operation: (context: SettingsFileLockContext) => T,
): T {
  const lock = acquireSettingsFileLock(filePath)
  let value: T | undefined
  let operationError: unknown
  try {
    value = operation(lock.context)
  } catch (error) {
    operationError = error
  }

  try {
    lock.release()
  } catch (releaseError) {
    if (operationError === undefined) {
      throw releaseError
    }
    logForDebugging(`Failed to release settings lock: ${releaseError}`, {
      level: 'error',
    })
  }

  if (operationError !== undefined) {
    throw operationError
  }
  return value as T
}

export function replaceSettingsFileSync(
  filePath: string,
  content: string,
): void {
  withSettingsFileLockSync(filePath, ({ targetPath, assertOwned }) => {
    assertOwned()
    markInternalWrite(filePath)
    writeFileSyncAndFlush_DEPRECATED(targetPath, content)
    resetSettingsCache()
  })
}

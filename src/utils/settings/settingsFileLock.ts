import { createHash, randomUUID } from 'crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'fs'
import { hostname } from 'os'
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

type SettingsLockRuntimeIdentity = {
  hostId: string
  bootId?: string
  runtimeId: string
}

function hashIdentity(parts: string[]): string {
  return `v1:${createHash('sha256').update(parts.join('\0')).digest('hex')}`
}

function readIdentityFile(path: string): string | undefined {
  try {
    const value = readFileSync(path, 'utf8').trim()
    return value || undefined
  } catch {
    return undefined
  }
}

function getSettingsLockRuntimeIdentity(): SettingsLockRuntimeIdentity {
  const stableHostIdentity =
    process.platform === 'linux'
      ? readIdentityFile('/etc/machine-id') ?? hostname()
      : hostname()
  const hostId = hashIdentity([
    'openclaude-settings-host',
    process.platform,
    stableHostIdentity,
  ])
  let bootId: string | undefined
  let namespaceId = ''
  if (process.platform === 'linux') {
    const linuxBootId = readIdentityFile('/proc/sys/kernel/random/boot_id')
    if (linuxBootId) {
      bootId = hashIdentity(['openclaude-settings-boot', linuxBootId])
    }
    try {
      // Follow the procfs link: lstat identifies the per-process symlink,
      // while stat identifies the PID namespace shared by peer processes.
      const namespace = statSync('/proc/self/ns/pid')
      namespaceId = `${namespace.dev}:${namespace.ino}`
    } catch {
      // PID namespace identity is unavailable on some Linux environments.
    }
  }
  return {
    hostId,
    ...(bootId ? { bootId } : {}),
    runtimeId: hashIdentity([
      'openclaude-settings-runtime',
      process.platform,
      hostId,
      bootId ?? '',
      namespaceId,
    ]),
  }
}

const SETTINGS_LOCK_RUNTIME = getSettingsLockRuntimeIdentity()

function getLinuxProcessStartId(
  pid: number,
  runtimeId: string,
): string | undefined {
  if (process.platform !== 'linux') return undefined
  const stat = readIdentityFile(`/proc/${pid}/stat`)
  if (!stat) return undefined

  // The command name in procfs is parenthesized and may contain spaces. Fields
  // after its final ')' begin at field 3; process start time is field 22.
  const commandEnd = stat.lastIndexOf(')')
  if (commandEnd === -1) return undefined
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/)
  const startTime = fields[19]
  if (!startTime) return undefined

  return hashIdentity([
    'openclaude-settings-process',
    runtimeId,
    String(pid),
    startTime,
  ])
}

type SettingsLockOwner = {
  bootId?: string
  hostId?: string
  pid: number
  processStartId?: string
  runtimeId?: string
  token: string
}

function createSettingsLockOwner(
  pid: number,
  token: string,
): SettingsLockOwner {
  const processStartId = getLinuxProcessStartId(
    pid,
    SETTINGS_LOCK_RUNTIME.runtimeId,
  )
  return {
    pid,
    ...SETTINGS_LOCK_RUNTIME,
    ...(processStartId ? { processStartId } : {}),
    token,
  }
}

type LockIdentity = {
  dev: number
  ino: number
  birthtimeMs: number
}

const locallyAbandonedSettingsLocks = new Map<
  string,
  { identity: LockIdentity; owner: SettingsLockOwner }
>()

export type SettingsFileLockContext = {
  targetPath: string
  assertOwned(): void
}

export class SettingsFileLockOwnershipError extends Error {}

export function getSettingsFileLockPath(targetPath: string): string {
  const lockId = hashIdentity([
    'openclaude-settings-lock',
    resolve(targetPath),
  ]).slice(3)
  return join(dirname(targetPath), `.openclaude-settings-lock-${lockId}`)
}

function getSettingsLockPaths(targetPath: string): {
  lockPath: string
  ownerPath: string
} {
  const lockPath = getSettingsFileLockPath(targetPath)
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
    const optionalIdentityIsValid = (value: unknown): boolean =>
      value === undefined ||
      (typeof value === 'string' && value.length > 0 && value.length <= 256)
    return Number.isSafeInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      optionalIdentityIsValid(parsed.hostId) &&
      optionalIdentityIsValid(parsed.bootId) &&
      optionalIdentityIsValid(parsed.processStartId) &&
      optionalIdentityIsValid(parsed.runtimeId) &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      parsed.token.length <= 128
      ? {
          pid: parsed.pid!,
          ...(parsed.hostId ? { hostId: parsed.hostId } : {}),
          ...(parsed.bootId ? { bootId: parsed.bootId } : {}),
          ...(parsed.processStartId
            ? { processStartId: parsed.processStartId }
            : {}),
          ...(parsed.runtimeId ? { runtimeId: parsed.runtimeId } : {}),
          token: parsed.token,
        }
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

function isProcessDead(owner: SettingsLockOwner): boolean {
  // Metadata without a runtime boundary cannot distinguish a local dead PID
  // from a live owner on another host or PID namespace. It must fail closed.
  if (!owner.hostId || !owner.runtimeId) {
    return false
  }
  if (owner.hostId !== SETTINGS_LOCK_RUNTIME.hostId) {
    return false
  }
  // A different boot on the same stable host proves the old process is gone.
  if (
    owner.bootId &&
    SETTINGS_LOCK_RUNTIME.bootId &&
    owner.bootId !== SETTINGS_LOCK_RUNTIME.bootId
  ) {
    return true
  }
  // On the same boot, a mismatch represents another PID namespace. A local
  // ESRCH result says nothing about liveness there, so recovery stays closed.
  if (owner.runtimeId !== SETTINGS_LOCK_RUNTIME.runtimeId) return false
  if (owner.processStartId) {
    const currentProcessStartId = getLinuxProcessStartId(
      owner.pid,
      owner.runtimeId,
    )
    if (
      currentProcessStartId &&
      currentProcessStartId !== owner.processStartId
    ) {
      return true
    }
  }
  try {
    process.kill(owner.pid, 0)
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

function createSettingsLockfileFs(
  lockPath: string,
  getOwnedIdentity: () => LockIdentity | null,
) {
  return {
    mkdirSync,
    realpathSync,
    rmdirSync(path: string): void {
      const ownedIdentity = getOwnedIdentity()
      if (
        resolve(path) === lockPath &&
        ownedIdentity &&
        !lockIdentityMatches(readLockIdentity(lockPath), ownedIdentity)
      ) {
        // proper-lockfile treats ENOENT as a successful unlock. Once our
        // original directory has moved, this retires its timer/state without
        // deleting a successor that already reused the canonical path.
        throw Object.assign(new Error('Settings lock path was replaced'), {
          code: 'ENOENT',
          path,
        })
      }
      rmdirSync(path)
    },
    // proper-lockfile uses stat for contention and mtime updates. Keep those
    // operations on the directory entry itself so a lock-path symlink cannot
    // redirect them to another filesystem location.
    statSync: lstatSync,
    utimesSync: lutimesSync,
  }
}

function ownersMatch(
  left: SettingsLockOwner | null,
  right: SettingsLockOwner,
): boolean {
  return (
    left !== null &&
    left.pid === right.pid &&
    left.runtimeId === right.runtimeId &&
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

function metadataMatches(
  ownerPath: string,
  expectedOwner: SettingsLockOwner | null,
): boolean {
  return expectedOwner
    ? ownersMatch(readOwner(ownerPath), expectedOwner)
    : pathIsAbsent(ownerPath)
}

function claimRecoveryPath(
  lockPath: string,
  identity: LockIdentity,
  ownerPath: string,
  owner: SettingsLockOwner,
  recoveryOwner: SettingsLockOwner,
): string | null {
  const fs = getFsImplementation()
  const claimId = hashIdentity([
    'openclaude-settings-recovery-claim',
    lockPath,
  ]).slice(3)
  const recoveryPath = join(
    dirname(lockPath),
    `.openclaude-settings-claim-${claimId}`,
  )
  try {
    writeOwner(recoveryPath, recoveryOwner)
    return recoveryPath
  } catch (error) {
    if (getErrnoCode(error) !== 'EEXIST') {
      throw error
    }
  }

  // Staleness is intentionally disabled for settings locks, so a recovery
  // claim left by a confirmed-dead process must itself be recoverable.
  const existingClaim = readOwner(recoveryPath)
  if (!existingClaim || !isProcessDead(existingClaim)) {
    return null
  }
  if (
    !ownersMatch(readOwner(ownerPath), owner) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity) ||
    !ownersMatch(readOwner(recoveryPath), existingClaim)
  ) {
    return null
  }

  try {
    fs.unlinkSync(recoveryPath)
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') {
      return null
    }
    throw error
  }

  // Revalidate the dead lock after removing the orphan. If another contender
  // changed it, leave the path unclaimed and let a later acquisition retry.
  if (
    !ownersMatch(readOwner(ownerPath), owner) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity)
  ) {
    return null
  }

  try {
    writeOwner(recoveryPath, recoveryOwner)
    return recoveryPath
  } catch (error) {
    if (getErrnoCode(error) === 'EEXIST') {
      return null
    }
    throw error
  }
}

function releaseRecoveryClaim(
  recoveryPath: string,
  recoveryOwner: SettingsLockOwner,
): void {
  if (!ownersMatch(readOwner(recoveryPath), recoveryOwner)) return
  try {
    getFsImplementation().unlinkSync(recoveryPath)
  } catch (error) {
    if (getErrnoCode(error) !== 'ENOENT') {
      logForDebugging(`Failed to release settings recovery claim: ${error}`, {
        level: 'error',
      })
    }
  }
}

type QuarantinedSettingsLock = {
  lockPath: string
  ownerPath: string
  recoveryPath: string
}

function quarantineSettingsLock(
  lockPath: string,
  identity: LockIdentity,
  owner: SettingsLockOwner | null,
  recoveryOwner: SettingsLockOwner | null,
  purpose: 'aborted' | 'ownerless' | 'recovered' | 'released',
): QuarantinedSettingsLock | null {
  const fs = getFsImplementation()
  const ownerPath = join(lockPath, 'owner.json')
  const recoveryPath = join(lockPath, 'recovery.json')
  if (
    !metadataMatches(ownerPath, owner) ||
    !lockIdentityMatches(readLockIdentity(lockPath), identity) ||
    !metadataMatches(recoveryPath, recoveryOwner)
  ) {
    return null
  }

  // Keep the sibling basename independent of the target name and all on-disk
  // metadata. This stays within NAME_MAX for long settings filenames and keeps
  // untrusted tokens from influencing the rename destination.
  const cleanupPath = join(
    dirname(lockPath),
    `.openclaude-settings-${purpose}-${randomUUID()}`,
  )
  try {
    fs.renameSync(lockPath, cleanupPath)
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') {
      return null
    }
    throw error
  }

  const cleanupOwnerPath = join(cleanupPath, 'owner.json')
  const cleanupRecoveryPath = join(cleanupPath, 'recovery.json')
  if (
    !metadataMatches(cleanupOwnerPath, owner) ||
    !lockIdentityMatches(readLockIdentity(cleanupPath), identity) ||
    !metadataMatches(cleanupRecoveryPath, recoveryOwner)
  ) {
    try {
      if (pathIsAbsent(lockPath)) {
        fs.renameSync(cleanupPath, lockPath)
      }
    } catch {
      // The ownership-change error below is more useful than cleanup failure.
    }
    throw new SettingsFileLockOwnershipError(
      'Settings lock ownership changed during quarantine',
    )
  }

  return {
    lockPath: cleanupPath,
    ownerPath: cleanupOwnerPath,
    recoveryPath: cleanupRecoveryPath,
  }
}

/**
 * Quarantine the exact directory acquired by this process when publishing its
 * owner token fails. The owner file may be partial or malformed, so identity
 * and the absence of recovery metadata are the only trustworthy predicates.
 */
function quarantineAbortedSettingsLock(
  lockPath: string,
  identity: LockIdentity,
): QuarantinedSettingsLock | null {
  const fs = getFsImplementation()
  const recoveryPath = join(lockPath, 'recovery.json')
  if (
    !lockIdentityMatches(readLockIdentity(lockPath), identity) ||
    !pathIsAbsent(recoveryPath)
  ) {
    return null
  }

  const cleanupPath = join(
    dirname(lockPath),
    `.openclaude-settings-aborted-${randomUUID()}`,
  )
  try {
    fs.renameSync(lockPath, cleanupPath)
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') return null
    throw error
  }

  const cleanupRecoveryPath = join(cleanupPath, 'recovery.json')
  if (
    !lockIdentityMatches(readLockIdentity(cleanupPath), identity) ||
    !pathIsAbsent(cleanupRecoveryPath)
  ) {
    try {
      if (pathIsAbsent(lockPath)) fs.renameSync(cleanupPath, lockPath)
    } catch {
      // Preserve the ownership error below.
    }
    throw new SettingsFileLockOwnershipError(
      'Settings lock ownership changed during aborted acquisition',
    )
  }

  return {
    lockPath: cleanupPath,
    ownerPath: join(cleanupPath, 'owner.json'),
    recoveryPath: cleanupRecoveryPath,
  }
}

function cleanupQuarantinedSettingsLock(
  quarantined: QuarantinedSettingsLock,
): void {
  const fs = getFsImplementation()
  for (const metadataPath of [
    quarantined.ownerPath,
    quarantined.recoveryPath,
  ]) {
    try {
      fs.unlinkSync(metadataPath)
    } catch (error) {
      if (getErrnoCode(error) !== 'ENOENT') {
        logForDebugging(
          `Failed to clean quarantined settings lock metadata: ${error}`,
          { level: 'error' },
        )
      }
    }
  }
  try {
    fs.rmdirSync(quarantined.lockPath)
  } catch (error) {
    // The canonical lock path is already free. A uniquely named cleanup
    // directory is harmless and must not make this acquisition fail.
    logForDebugging(`Failed to clean quarantined settings lock: ${error}`, {
      level: 'error',
    })
  }
}

function quarantineRecoveredLock(
  lockPath: string,
  identity: LockIdentity,
  owner: SettingsLockOwner | null,
  recoveryOwner: SettingsLockOwner,
): boolean {
  const quarantined = quarantineSettingsLock(
    lockPath,
    identity,
    owner,
    recoveryOwner,
    'recovered',
  )
  if (!quarantined) return false

  cleanupQuarantinedSettingsLock(quarantined)
  locallyAbandonedSettingsLocks.delete(lockPath)
  return true
}

function removeOwnerlessRecoveryClaim(
  lockPath: string,
  identity: LockIdentity,
): boolean {
  const recoveryPath = join(lockPath, 'recovery.json')
  const recoveryOwner = readOwner(recoveryPath)
  if (recoveryOwner) {
    if (!isProcessDead(recoveryOwner)) return false
    return quarantineRecoveredLock(
      lockPath,
      identity,
      null,
      recoveryOwner,
    )
  }
  return false
}

function removeDeadOwnerLock(
  lockPath: string,
  ownerPath: string,
): boolean {
  const identity = readLockIdentity(lockPath)
  if (!identity) {
    return false
  }
  const owner = readOwner(ownerPath)
  if (!owner) {
    locallyAbandonedSettingsLocks.delete(lockPath)
    // Missing ownership metadata is ambiguous: a live acquisition exists
    // briefly before owner.json is published, and metadata can also disappear
    // while its owner is still alive. Never recover on age alone. The only
    // ownerless state we can prove abandoned is a dead recovery claimant.
    return removeOwnerlessRecoveryClaim(lockPath, identity)
  }
  const abandoned = locallyAbandonedSettingsLocks.get(lockPath)
  const locallyAbandoned =
    abandoned !== undefined &&
    lockIdentityMatches(identity, abandoned.identity) &&
    ownersMatch(owner, abandoned.owner)
  if (abandoned && !locallyAbandoned) {
    locallyAbandonedSettingsLocks.delete(lockPath)
  }
  if (!locallyAbandoned && !isProcessDead(owner)) {
    return false
  }

  // Recover claim metadata written by older versions as one quarantined unit;
  // never unlink through the mutable lock directory before its identity moves.
  const legacyRecoveryPath = join(lockPath, 'recovery.json')
  if (!pathIsAbsent(legacyRecoveryPath)) {
    const legacyRecoveryOwner = readOwner(legacyRecoveryPath)
    if (!legacyRecoveryOwner || !isProcessDead(legacyRecoveryOwner)) {
      return false
    }
    return quarantineRecoveredLock(
      lockPath,
      identity,
      owner,
      legacyRecoveryOwner,
    )
  }

  // Only one contender may recover this dead directory. Without this
  // exclusive sibling claim, a delayed contender can rename a successor that
  // already reused the canonical lock path. Keeping the claim outside that
  // mutable directory also prevents lock-path symlinks from redirecting it.
  const recoveryOwner = createSettingsLockOwner(process.pid, randomUUID())
  const recoveryPath = claimRecoveryPath(
    lockPath,
    identity,
    ownerPath,
    owner,
    recoveryOwner,
  )
  if (!recoveryPath) {
    return false
  }

  try {
    const quarantined = quarantineSettingsLock(
      lockPath,
      identity,
      owner,
      null,
      'recovered',
    )
    if (!quarantined) return false
    cleanupQuarantinedSettingsLock(quarantined)
    locallyAbandonedSettingsLocks.delete(lockPath)
    return true
  } finally {
    releaseRecoveryClaim(recoveryPath, recoveryOwner)
  }
}

export function resolveSettingsFileTarget(filePath: string): string {
  const fs = getFsImplementation()
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) {
    return filePath
  }
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
    try {
      const stats = fs.lstatSync(targetPath)
      if (
        stats.isFIFO() ||
        stats.isSocket() ||
        stats.isCharacterDevice() ||
        stats.isBlockDevice()
      ) {
        return targetPath
      }
    } catch {
      // Missing and dangling paths are resolved through their deepest ancestor.
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
  const owner = createSettingsLockOwner(process.pid, randomUUID())
  let compromisedError: Error | null = null
  let identity: LockIdentity | null = null
  const lockfileFs = createSettingsLockfileFs(lockPath, () => identity)

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
      fs: lockfileFs,
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

  let ownerWritten = false
  try {
    identity = readLockIdentity(lockPath)
    if (!identity) {
      throw new Error('Settings lock path is not a directory')
    }
    writeOwner(ownerPath, owner)
    ownerWritten = true
    if (!lockIdentityMatches(readLockIdentity(lockPath), identity)) {
      throw new SettingsFileLockOwnershipError(
        'Settings lock ownership changed during acquisition',
      )
    }
  } catch (error) {
    let quarantined: QuarantinedSettingsLock | null = null
    try {
      quarantined = identity
        ? quarantineAbortedSettingsLock(lockPath, identity)
        : null
    } catch {
      // Preserve the owner-write/stat failure.
    }
    try {
      // Retire proper-lockfile's refresh timer even when quarantine failed.
      releaseLock()
    } catch {
      // Preserve the owner-write/stat failure.
    }
    if (quarantined) {
      cleanupQuarantinedSettingsLock(quarantined)
    } else if (
      ownerWritten &&
      identity &&
      ownersMatch(readOwner(ownerPath), owner) &&
      lockIdentityMatches(readLockIdentity(lockPath), identity)
    ) {
      locallyAbandonedSettingsLocks.set(lockPath, { identity, owner })
    }
    throw error
  }

  const assertOwned = (): void => {
    let currentTarget: string
    try {
      currentTarget = resolveSettingsFileTarget(filePath)
    } catch (error) {
      throw new SettingsFileLockOwnershipError(
        `Settings file target changed during update: ${toError(error).message}`,
      )
    }
    if (currentTarget !== targetPath) {
      throw new SettingsFileLockOwnershipError(
        'Settings file target changed during update',
      )
    }
    if (compromisedError) {
      throw new SettingsFileLockOwnershipError(
        `Settings lock was compromised: ${compromisedError}`,
      )
    }
    if (
      !ownersMatch(readOwner(ownerPath), owner) ||
      !identity ||
      !lockIdentityMatches(readLockIdentity(lockPath), identity)
    ) {
      throw new SettingsFileLockOwnershipError(
        'Settings lock ownership changed during update',
      )
    }
  }

  let released = false
  return {
    context: { targetPath, assertOwned },
    release(): void {
      if (released) return
      let quarantined: QuarantinedSettingsLock | null = null
      let ownershipError: Error | null = null
      try {
        assertOwned()
        if (!identity) {
          throw new Error(
            'Settings lock identity is unavailable during release',
          )
        }
        quarantined = quarantineSettingsLock(
          lockPath,
          identity,
          owner,
          null,
          'released',
        )
        if (!quarantined) {
          throw new SettingsFileLockOwnershipError(
            'Settings lock ownership changed during release',
          )
        }
      } catch (error) {
        ownershipError = toError(error)
      }

      let unlockError: Error | null = null
      try {
        releaseLock()
        released = true
      } catch (error) {
        unlockError = toError(error)
      }
      if (quarantined) {
        cleanupQuarantinedSettingsLock(quarantined)
      } else if (
        ownershipError &&
        identity &&
        ownersMatch(readOwner(ownerPath), owner) &&
        lockIdentityMatches(readLockIdentity(lockPath), identity)
      ) {
        // proper-lockfile retires its refresh handle before attempting rmdir.
        // If the guarded rename failed first, remember this exact token so a
        // later acquisition in this runtime may quarantine it despite our PID
        // still being alive. A mismatched identity or token still fails closed.
        locallyAbandonedSettingsLocks.set(lockPath, { identity, owner })
      }
      if (ownershipError) {
        throw ownershipError
      }
      if (unlockError) {
        throw unlockError
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

export type SettingsFileReplacementResult = {
  written: boolean
  error?: Error
}

export function replaceSettingsFileSync(
  filePath: string,
  content: string,
): SettingsFileReplacementResult {
  let written = false
  try {
    withSettingsFileLockSync(filePath, ({ targetPath, assertOwned }) => {
      assertOwned()
      writeFileSyncAndFlush_DEPRECATED(targetPath, content, {
        encoding: 'utf-8',
        preserveSymlink: false,
      })
      written = true
      markInternalWrite(filePath)
      markInternalWrite(targetPath)
      resetSettingsCache()
    })
    return { written: true }
  } catch (error) {
    return { written, error: toError(error) }
  }
}

import { lstatSync, readlinkSync } from 'node:fs'
import { lstat, readlink } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { getErrnoCode } from './errors.js'
import * as lockfile from './lockfile.js'

const TRANSCRIPT_LOCK_STALE_MS = 30_000
const TRANSCRIPT_LOCK_WAIT_MS = 30_000
const syncWaitBuffer = new Int32Array(new SharedArrayBuffer(4))
const heldLockCounts = new Map<string, number>()

async function resolveTranscriptMutationTarget(
  requestedPath: string,
): Promise<string> {
  let currentPath = resolve(requestedPath)
  const visited = new Set<string>()

  for (let depth = 0; depth < 40; depth++) {
    if (visited.has(currentPath)) {
      throw new Error(`Cannot lock circular transcript symlink: ${requestedPath}`)
    }
    visited.add(currentPath)

    let fileStat
    try {
      fileStat = await lstat(currentPath)
    } catch (error) {
      if (getErrnoCode(error) === 'ENOENT') return currentPath
      throw error
    }
    if (!fileStat.isSymbolicLink()) return currentPath

    const linkTarget = await readlink(currentPath)
    currentPath = isAbsolute(linkTarget)
      ? linkTarget
      : resolve(dirname(currentPath), linkTarget)
  }

  throw new Error(`Cannot lock transcript symlink chain: ${requestedPath}`)
}

function resolveTranscriptMutationTargetSync(requestedPath: string): string {
  let currentPath = resolve(requestedPath)
  const visited = new Set<string>()

  for (let depth = 0; depth < 40; depth++) {
    if (visited.has(currentPath)) {
      throw new Error(`Cannot lock circular transcript symlink: ${requestedPath}`)
    }
    visited.add(currentPath)

    let fileStat
    try {
      fileStat = lstatSync(currentPath)
    } catch (error) {
      if (getErrnoCode(error) === 'ENOENT') return currentPath
      throw error
    }
    if (!fileStat.isSymbolicLink()) return currentPath

    const linkTarget = readlinkSync(currentPath)
    currentPath = isAbsolute(linkTarget)
      ? linkTarget
      : resolve(dirname(currentPath), linkTarget)
  }

  throw new Error(`Cannot lock transcript symlink chain: ${requestedPath}`)
}

function incrementHeldLock(targetPath: string): void {
  heldLockCounts.set(targetPath, (heldLockCounts.get(targetPath) ?? 0) + 1)
}

function decrementHeldLock(targetPath: string): void {
  const remaining = (heldLockCounts.get(targetPath) ?? 1) - 1
  if (remaining === 0) heldLockCounts.delete(targetPath)
  else heldLockCounts.set(targetPath, remaining)
}

function asyncLockOptions(targetPath: string) {
  return {
    lockfilePath: `${targetPath}.lock`,
    realpath: false,
    stale: TRANSCRIPT_LOCK_STALE_MS,
    update: 5_000,
    retries: {
      retries: 240,
      factor: 1.1,
      minTimeout: 5,
      maxTimeout: 250,
      randomize: true,
    },
  }
}

function acquireTranscriptLockSync(targetPath: string): () => void {
  const deadline = Date.now() + TRANSCRIPT_LOCK_WAIT_MS
  let retryDelay = 5

  while (true) {
    try {
      return lockfile.lockSync(targetPath, {
        lockfilePath: `${targetPath}.lock`,
        realpath: false,
        stale: TRANSCRIPT_LOCK_STALE_MS,
        update: 5_000,
      })
    } catch (error) {
      if (getErrnoCode(error) !== 'ELOCKED' || Date.now() >= deadline) {
        throw error
      }
      Atomics.wait(syncWaitBuffer, 0, 0, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 100)
    }
  }
}

/** Serialize a complete transcript mutation with writers in other processes. */
export async function withTranscriptFileLock<T>(
  requestedPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const targetPath = await resolveTranscriptMutationTarget(requestedPath)
  const release = await lockfile.lock(targetPath, asyncLockOptions(targetPath))
  incrementHeldLock(targetPath)
  try {
    return await operation()
  } finally {
    try {
      await release()
    } finally {
      decrementHeldLock(targetPath)
    }
  }
}

/** Synchronous counterpart for shutdown and metadata append call sites. */
export function withTranscriptFileLockSync<T>(
  requestedPath: string,
  operation: () => T,
): T {
  const targetPath = resolveTranscriptMutationTargetSync(requestedPath)
  if ((heldLockCounts.get(targetPath) ?? 0) > 0) return operation()

  const release = acquireTranscriptLockSync(targetPath)
  incrementHeldLock(targetPath)
  try {
    return operation()
  } finally {
    try {
      release()
    } finally {
      decrementHeldLock(targetPath)
    }
  }
}

/** @internal Verify exact lock coverage in deterministic concurrency tests. */
export async function isTranscriptFileLockHeldForTesting(
  requestedPath: string,
): Promise<boolean> {
  const targetPath = await resolveTranscriptMutationTarget(requestedPath)
  return (heldLockCounts.get(targetPath) ?? 0) > 0
}

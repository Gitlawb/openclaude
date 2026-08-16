import { dirname, resolve } from 'node:path'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../file.js'
import {
  getFsImplementation,
  resolveDeepestExistingAncestorSync,
} from '../fsOperations.js'
import * as lockfile from '../lockfile.js'
import { markInternalWrite } from './internalWrites.js'
import { resetSettingsCache } from './settingsCache.js'

const SETTINGS_LOCK_RETRY_MS = 25
const SETTINGS_LOCK_WAIT_MS = 2_000
const SETTINGS_LOCK_STALE_MS = 30_000
const SETTINGS_LOCK_UPDATE_MS = 5_000
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

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
  const deadline = performance.now() + SETTINGS_LOCK_WAIT_MS
  while (true) {
    try {
      return lockfile.lockSync(targetPath, {
        lockfilePath: `${targetPath}.lock`,
        realpath: false,
        stale: SETTINGS_LOCK_STALE_MS,
        update: SETTINGS_LOCK_UPDATE_MS,
        onCompromised: error => {
          logForDebugging(`Settings file lock compromised: ${error}`, {
            level: 'error',
          })
        },
      })
    } catch (error) {
      if (getErrnoCode(error) !== 'ELOCKED') throw error
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        throw Object.assign(
          new Error(
            `Timed out after ${SETTINGS_LOCK_WAIT_MS}ms waiting for the settings file lock`,
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
}

/** Run one synchronous settings-file operation under its physical-target lock. */
export function withSettingsFileTransactionSync<T>(
  requestedPath: string,
  operation: (targetPath: string) => T,
): T {
  const targetPath = resolveSettingsMutationTarget(requestedPath)
  getFsImplementation().mkdirSync(dirname(targetPath))
  const release = acquireSettingsLock(targetPath)
  try {
    return operation(targetPath)
  } finally {
    release()
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

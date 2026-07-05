import { AsyncLocalStorage, createHook, executionAsyncId } from 'async_hooks'
import { getCwdState, getOriginalCwd } from '../bootstrap/state.js'

const cwdOverrideStorage = new AsyncLocalStorage<string>()
const cwdOverridesByAsyncId = new Map<number, string>()
let syncCwdOverride: string | undefined

createHook({
  init(asyncId, _type, triggerAsyncId) {
    const cwd = cwdOverridesByAsyncId.get(triggerAsyncId)
    if (cwd !== undefined) {
      cwdOverridesByAsyncId.set(asyncId, cwd)
    }
  },
  destroy(asyncId) {
    cwdOverridesByAsyncId.delete(asyncId)
  },
}).enable()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  const asyncId = executionAsyncId()
  const previous = cwdOverridesByAsyncId.get(asyncId)
  const previousSync = syncCwdOverride
  cwdOverridesByAsyncId.set(asyncId, cwd)
  syncCwdOverride = cwd

  const restoreAsyncOverride = () => {
    if (previous === undefined) {
      cwdOverridesByAsyncId.delete(asyncId)
    } else {
      cwdOverridesByAsyncId.set(asyncId, previous)
    }
  }

  const restore = () => {
    restoreAsyncOverride()
    syncCwdOverride = previousSync
  }

  return cwdOverrideStorage.run(cwd, () => {
    cwdOverridesByAsyncId.set(executionAsyncId(), cwd)
    cwdOverrideStorage.enterWith(cwd)
    try {
      const result = fn()
      if (
        typeof result === 'object' &&
        result !== null &&
        'finally' in result &&
        typeof result.finally === 'function'
      ) {
        syncCwdOverride = previousSync
        return result.finally(restoreAsyncOverride) as T
      }
      restore()
      return result
    } catch (error) {
      restore()
      throw error
    }
  })
}

/**
 * Get the current working directory
 */
export function pwd(): string {
  return getCwdOverride() ?? getCwdState()
}

function getCwdOverride(): string | undefined {
  return syncCwdOverride ??
    cwdOverridesByAsyncId.get(executionAsyncId()) ??
    cwdOverrideStorage.getStore()
}

/**
 * Get the current working directory or the original working directory if the current one is not available
 */
export function getCwd(): string {
  const override = getCwdOverride()
  if (override !== undefined) return override
  try {
    return getCwdState()
  } catch {
    return getOriginalCwd()
  }
}

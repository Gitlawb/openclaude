import { AsyncLocalStorage, createHook, executionAsyncId } from 'async_hooks'
import { getCwdState, getOriginalCwd } from '../bootstrap/state.js'

const cwdOverrideStorage = new AsyncLocalStorage<string>()
const activeScopedOverrides = new Set<Map<number, string>>()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  const scopedOverrides = new Map<number, string>()
  const initialAsyncId = executionAsyncId()
  scopedOverrides.set(initialAsyncId, cwd)
  activeScopedOverrides.add(scopedOverrides)

  const hook = createHook({
    init(asyncId, _type, triggerAsyncId) {
      const inherited = scopedOverrides.get(triggerAsyncId)
      if (inherited !== undefined) {
        scopedOverrides.set(asyncId, inherited)
      }
    },
    destroy(asyncId) {
      scopedOverrides.delete(asyncId)
    },
  })

  const cleanup = () => {
    hook.disable()
    activeScopedOverrides.delete(scopedOverrides)
    scopedOverrides.clear()
  }

  hook.enable()

  try {
    const result = cwdOverrideStorage.run(cwd, fn)
    if (isPromiseLike(result)) {
      scopedOverrides.delete(initialAsyncId)
      return result.finally(cleanup) as T
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

/**
 * Get the current working directory
 */
export function pwd(): string {
  return getCwdOverride() ?? getCwdState()
}

function getCwdOverride(): string | undefined {
  const asyncId = executionAsyncId()
  return cwdOverrideStorage.getStore() ?? getScopedCwdOverride(asyncId)
}

function getScopedCwdOverride(asyncId: number): string | undefined {
  const scopedOverrideStack = [...activeScopedOverrides].reverse()
  for (const scopedOverrides of scopedOverrideStack) {
    const cwd = scopedOverrides.get(asyncId)
    if (cwd !== undefined) return cwd
  }
  return undefined
}

function isPromiseLike<T>(value: T): value is T & { finally(onfinally: () => void): unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'finally' in value &&
    typeof value.finally === 'function'
  )
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

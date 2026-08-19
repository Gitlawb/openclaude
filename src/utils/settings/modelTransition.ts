import { stableStringify } from '../stableStringify.js'
import {
  applySettingsPatch,
  SETTINGS_UPDATE_NO_CHANGE,
  type SettingsWriteResult,
  updateSettingsForSourceWithFreshSettings,
  updateSettingsForSourceWithFreshSettingsOrNoop,
  wasSettingsUpdateApplied,
  wasSettingsUpdateCommitted,
} from './settings.js'
import type { SettingsJson } from './types.js'

export type ModelSettingsTransition = {
  attempted: SettingsJson
  previous: SettingsJson
}

export type ModelSettingsRollbackResult =
  | { status: 'restored' }
  | { status: 'superseded' }
  | { status: 'failed'; error: string }

type ModelSettingsTransitionDependencies = {
  updateFresh?: typeof updateSettingsForSourceWithFreshSettings
  updateFreshOrNoop?: typeof updateSettingsForSourceWithFreshSettingsOrNoop
}

function sameSettingValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

/**
 * Commit a model patch while capturing the exact settings snapshot that the
 * write replaced. Callers can use the returned token to roll back without
 * restoring a stale render-time cache over another process's newer update.
 */
export function commitSettingsTransition(
  attempted: SettingsJson,
  dependencies: ModelSettingsTransitionDependencies = {},
): {
  result: SettingsWriteResult
  transition?: ModelSettingsTransition
} {
  let transition: ModelSettingsTransition | undefined
  const result = (
    dependencies.updateFresh ?? updateSettingsForSourceWithFreshSettings
  )('userSettings', freshSettings => {
    const mergedSettings = applySettingsPatch(freshSettings, attempted)
    const attemptedKeys = Object.keys(attempted) as Array<keyof SettingsJson>
    transition = {
      attempted: Object.fromEntries(
        attemptedKeys.map(key => [key, structuredClone(mergedSettings[key])]),
      ) as SettingsJson,
      previous: structuredClone(freshSettings),
    }
    return attempted
  })
  return wasSettingsUpdateCommitted(result)
    ? { result, transition }
    : { result }
}

export function commitModelSettingsTransition(
  model: string | null,
  additionalSettings: SettingsJson = {},
  dependencies: ModelSettingsTransitionDependencies = {},
): {
  result: SettingsWriteResult
  transition?: ModelSettingsTransition
} {
  return commitSettingsTransition(
    {
      ...additionalSettings,
      model: model ?? undefined,
    },
    dependencies,
  )
}

/**
 * Extend a dialog-scoped transition without losing the lock-scoped preimage
 * from the first time each key was touched.
 */
export function mergeSettingsTransitions(
  existing: ModelSettingsTransition | null,
  next: ModelSettingsTransition,
): ModelSettingsTransition {
  if (!existing) return structuredClone(next)

  const previous = structuredClone(next.previous)
  for (const key of Object.keys(existing.attempted) as Array<keyof SettingsJson>) {
    previous[key] = structuredClone(existing.previous[key]) as never
  }
  return {
    attempted: {
      ...structuredClone(existing.attempted),
      ...structuredClone(next.attempted),
    },
    previous,
  }
}

/** Restore only when every key written by the transition is still unchanged. */
export function rollbackModelSettingsTransition(
  transition: ModelSettingsTransition,
  dependencies: ModelSettingsTransitionDependencies = {},
): ModelSettingsRollbackResult {
  let superseded = false
  const result = (
    dependencies.updateFreshOrNoop ??
    updateSettingsForSourceWithFreshSettingsOrNoop
  )('userSettings', freshSettings => {
    const keys = Object.keys(transition.attempted) as Array<keyof SettingsJson>
    if (
      keys.some(
        key =>
          !sameSettingValue(freshSettings[key], transition.attempted[key]),
      )
    ) {
      superseded = true
      return SETTINGS_UPDATE_NO_CHANGE
    }

    return Object.fromEntries(
      keys.map(key => [key, transition.previous[key]]),
    ) as SettingsJson
  })

  if (!wasSettingsUpdateApplied(result)) {
    return {
      status: 'failed',
      error: result.error?.message ?? 'settings rollback was not written',
    }
  }
  return superseded ? { status: 'superseded' } : { status: 'restored' }
}

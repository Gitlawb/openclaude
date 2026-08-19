import {
  setMainLoopModelOverride,
  setSessionBypassPermissionsMode,
  setSessionDangerousPermissionMode,
} from '../bootstrap/state.js'
import {
  clearApiKeyHelperCache,
  clearAwsCredentialsCache,
  clearGcpCredentialsCache,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { toError } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'
import { persistActiveProviderProfileModel } from '../utils/providerProfiles.js'
import {
  permissionModeFromString,
  toExternalPermissionMode,
} from '../utils/permissions/PermissionMode.js'
import {
  notifyPermissionModeChanged,
  notifySessionMetadataChanged,
  type SessionExternalMetadata,
} from '../utils/sessionState.js'
import {
  updateSettingsForSourceWithResult,
  wasSettingsUpdateCommitted,
} from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'
import type { AppState } from './AppStateStore.js'

type OnChangeAppStateDependencies = {
  updateUserSettings?: typeof updateSettingsForSourceWithResult
  setModelOverride?: typeof setMainLoopModelOverride
  persistProfileModel?: typeof persistActiveProviderProfileModel
}

const NO_PRECOMMITTED_MODEL = Symbol('no-precommitted-model')
let precommittedModel: string | null | typeof NO_PRECOMMITTED_MODEL =
  NO_PRECOMMITTED_MODEL

/**
 * Scope a synchronous AppState update whose model bytes have already reached
 * user settings. This prevents the observer from performing a second write
 * that could fail after a coordinated provider/model transition committed.
 */
export function withPrecommittedModelStateUpdate<T>(
  model: string | null,
  updateState: () => T,
): T {
  const previous = precommittedModel
  precommittedModel = model
  try {
    return updateState()
  } finally {
    precommittedModel = previous
  }
}

/**
 * Persist a model selection before applying its in-memory state transition.
 * Callers that own success UI can use the returned write result to avoid
 * closing or notifying when the transaction was rejected.
 */
export function commitModelStateUpdate<T>(
  model: string | null,
  updateState: () => T,
  updateUserSettings: typeof updateSettingsForSourceWithResult = updateSettingsForSourceWithResult,
  additionalSettings: SettingsJson = {},
): ReturnType<typeof updateSettingsForSourceWithResult> {
  const result = updateUserSettings('userSettings', {
    ...additionalSettings,
    model: model ?? undefined,
  })
  if (wasSettingsUpdateCommitted(result)) {
    withPrecommittedModelStateUpdate(model, updateState)
  }
  return result
}

// Inverse of the push below — restore on worker restart.
export function externalMetadataToAppState(
  metadata: SessionExternalMetadata,
): (prev: AppState) => AppState {
  return prev => ({
    ...prev,
    ...(typeof metadata.permission_mode === 'string'
      ? {
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            mode: permissionModeFromString(metadata.permission_mode),
          },
        }
      : {}),
    ...(typeof metadata.is_ultraplan_mode === 'boolean'
      ? { isUltraplanMode: metadata.is_ultraplan_mode }
      : {}),
  })
}

export function onChangeAppState({
  newState,
  oldState,
}: {
  newState: AppState
  oldState: AppState
}, dependencies?: OnChangeAppStateDependencies): AppState | void {
  const updateUserSettings =
    dependencies?.updateUserSettings ?? updateSettingsForSourceWithResult
  const setModelOverride =
    dependencies?.setModelOverride ?? setMainLoopModelOverride
  const persistProfileModel =
    dependencies?.persistProfileModel ?? persistActiveProviderProfileModel
  if (newState.mainLoopModel !== oldState.mainLoopModel) {
    // Validate the model before applying any other side effects from this
    // state transition. If persistence is rejected, the store rejects the
    // whole transition, so permission/config/runtime effects must not advance.
    const modelUpdate =
      precommittedModel !== NO_PRECOMMITTED_MODEL &&
      precommittedModel === newState.mainLoopModel
        ? ({
            status: 'committed',
            bytesOnDisk: true,
            committed: true,
            cacheInvalidated: true,
            sessionNotified: false,
            error: null,
            written: true,
          } satisfies ReturnType<typeof updateSettingsForSourceWithResult>)
        : updateUserSettings('userSettings', {
            model: newState.mainLoopModel ?? undefined,
          })
    if (!wasSettingsUpdateCommitted(modelUpdate)) return oldState

    setModelOverride(newState.mainLoopModel)
    if (
      newState.mainLoopModel !== null &&
      process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === '1'
    ) {
      persistProfileModel(newState.mainLoopModel)
    }
  }

  // toolPermissionContext.mode — single choke point for CCR/SDK mode sync.
  //
  // Prior to this block, mode changes were relayed to CCR by only 2 of 8+
  // mutation paths: a bespoke setAppState wrapper in print.ts (headless/SDK
  // mode only) and a manual notify in the set_permission_mode handler.
  // Every other path — Shift+Tab cycling, ExitPlanModePermissionRequest
  // dialog options, the /plan slash command, rewind, the REPL bridge's
  // onSetPermissionMode — mutated AppState without telling
  // CCR, leaving external_metadata.permission_mode stale and the web UI out
  // of sync with the CLI's actual mode.
  //
  // Hooking the diff here means ANY setAppState call that changes the mode
  // notifies CCR (via notifySessionMetadataChanged → ccrClient.reportMetadata)
  // and the SDK status stream (via notifyPermissionModeChanged → registered
  // in print.ts). The scattered callsites above need zero changes.
  const prevMode = oldState.toolPermissionContext.mode
  const newMode = newState.toolPermissionContext.mode
  if (prevMode !== newMode) {
    setSessionBypassPermissionsMode(
      newMode === 'bypassPermissions' || newMode === 'fullAccess',
    )
    setSessionDangerousPermissionMode(
      newMode === 'bypassPermissions' || newMode === 'fullAccess'
        ? newMode
        : null,
    )

    // CCR external_metadata must not receive internal-only mode names
    // (bubble, ungated auto). Externalize first — and skip
    // the CCR notify if the EXTERNAL mode didn't change (e.g.,
    // default→bubble→default is noise from CCR's POV since both
    // externalize to 'default'). The SDK channel (notifyPermissionModeChanged)
    // passes raw mode; its listener in print.ts applies its own filter.
    const prevExternal = toExternalPermissionMode(prevMode)
    const newExternal = toExternalPermissionMode(newMode)
    if (prevExternal !== newExternal) {
      // Ultraplan = first plan cycle only. The initial control_request
      // sets mode and isUltraplanMode atomically, so the flag's
      // transition gates it. null per RFC 7396 (removes the key).
      const isUltraplan =
        newExternal === 'plan' &&
        newState.isUltraplanMode &&
        !oldState.isUltraplanMode
          ? true
          : null
      notifySessionMetadataChanged({
        permission_mode: newExternal,
        is_ultraplan_mode: isUltraplan,
      })
    }
    notifyPermissionModeChanged(newMode)
  }

  // expandedView → persist as showExpandedTodos + showSpinnerTree for backwards compat
  if (newState.expandedView !== oldState.expandedView) {
    const showExpandedTodos = newState.expandedView === 'tasks'
    const showSpinnerTree = newState.expandedView === 'teammates'
    if (
      getGlobalConfig().showExpandedTodos !== showExpandedTodos ||
      getGlobalConfig().showSpinnerTree !== showSpinnerTree
    ) {
      saveGlobalConfig(current => ({
        ...current,
        showExpandedTodos,
        showSpinnerTree,
      }))
    }
  }

  // verbose
  if (
    newState.verbose !== oldState.verbose &&
    getGlobalConfig().verbose !== newState.verbose
  ) {
    const verbose = newState.verbose
    saveGlobalConfig(current => ({
      ...current,
      verbose,
    }))
  }

  // settings: clear auth-related caches when settings change
  // This ensures apiKeyHelper and AWS/GCP credential changes take effect immediately
  if (newState.settings !== oldState.settings) {
    try {
      clearApiKeyHelperCache()
      clearAwsCredentialsCache()
      clearGcpCredentialsCache()

      // Re-apply environment variables when settings.env changes
      // This is additive-only: new vars are added, existing may be overwritten, nothing is deleted
      if (newState.settings.env !== oldState.settings.env) {
        applyConfigEnvironmentVariables()
      }
    } catch (error) {
      logError(toError(error))
    }
  }

}

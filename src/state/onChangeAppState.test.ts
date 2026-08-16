import { describe, expect, mock, test } from 'bun:test'
import { settingsWriteResult } from '../test/settingsWriteResult.js'
import {
  getSessionBypassPermissionsMode,
  getSessionDangerousPermissionMode,
  setSessionBypassPermissionsMode,
  setSessionDangerousPermissionMode,
} from '../bootstrap/state.js'
import { setPermissionModeChangedListener } from '../utils/sessionState.js'
import { type AppState, getDefaultAppState } from './AppStateStore.js'
import {
  commitModelStateUpdate,
  onChangeAppState,
  withPrecommittedModelStateUpdate,
} from './onChangeAppState.js'
import { createStore } from './store.js'

describe('onChangeAppState model persistence', () => {
  test('keeps the previous model and runtime state when persistence is rejected', () => {
    const oldState: AppState = {
      ...getDefaultAppState(),
      mainLoopModel: 'claude-haiku-4-5',
      mainLoopModelForSession: 'claude-sonnet-4-6',
      fastMode: true,
    }
    const nextState: AppState = {
      ...oldState,
      mainLoopModel: 'claude-opus-4-5',
      mainLoopModelForSession: null,
      fastMode: false,
    }
    const setModelOverride = mock(() => {})
    const persistProfileModel = mock(() => null)
    const store = createStore(oldState, args =>
      onChangeAppState(args, {
        updateUserSettings: mock(() => settingsWriteResult({ written: false })),
        setModelOverride,
        persistProfileModel,
      }),
    )

    store.setState(() => nextState)

    expect(store.getState()).toBe(oldState)
    expect(setModelOverride).not.toHaveBeenCalled()
    expect(persistProfileModel).not.toHaveBeenCalled()
  })

  test('rejects combined permission side effects before a failed model write', () => {
    const previousBypassMode = getSessionBypassPermissionsMode()
    const previousDangerousMode = getSessionDangerousPermissionMode()
    const permissionListener = mock(() => {})
    setSessionBypassPermissionsMode(false)
    setSessionDangerousPermissionMode(null)
    setPermissionModeChangedListener(permissionListener)

    try {
      const oldState = getDefaultAppState()
      const nextState: AppState = {
        ...oldState,
        mainLoopModel: 'claude-opus-4-5',
        toolPermissionContext: {
          ...oldState.toolPermissionContext,
          mode: 'bypassPermissions',
        },
      }
      const store = createStore(oldState, args =>
        onChangeAppState(args, {
          updateUserSettings: mock(() =>
            settingsWriteResult({
              error: new Error('read-only settings'),
              written: false,
            }),
          ),
          setModelOverride: mock(() => {}),
          persistProfileModel: mock(() => null),
        }),
      )

      store.setState(() => nextState)

      expect(store.getState()).toBe(oldState)
      expect(getSessionBypassPermissionsMode()).toBe(false)
      expect(getSessionDangerousPermissionMode()).toBeNull()
      expect(permissionListener).not.toHaveBeenCalled()
    } finally {
      setPermissionModeChangedListener(null)
      setSessionBypassPermissionsMode(previousBypassMode)
      setSessionDangerousPermissionMode(previousDangerousMode)
    }
  })

  test('accepts a committed model write even when lock cleanup reports an error', () => {
    const previousProfileApplied =
      process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
    const oldState: AppState = {
      ...getDefaultAppState(),
      mainLoopModel: 'claude-haiku-4-5',
    }
    const nextState: AppState = {
      ...oldState,
      mainLoopModel: 'claude-opus-4-5',
    }
    const setModelOverride = mock(() => {})
    const persistProfileModel = mock(() => null)
    const store = createStore(oldState, args =>
      onChangeAppState(args, {
        updateUserSettings: mock(() =>
          settingsWriteResult({
            error: new Error('lock release failed'),
            written: true,
          }),
        ),
        setModelOverride,
        persistProfileModel,
      }),
    )

    try {
      store.setState(() => nextState)

      expect(store.getState().mainLoopModel).toBe('claude-opus-4-5')
      expect(setModelOverride).toHaveBeenCalledWith('claude-opus-4-5')
      expect(persistProfileModel).toHaveBeenCalledWith('claude-opus-4-5')
    } finally {
      if (previousProfileApplied === undefined) {
        delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
      } else {
        process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED =
          previousProfileApplied
      }
    }
  })

  test('revalidates an externally committed model through the locked updater', () => {
    const oldState: AppState = {
      ...getDefaultAppState(),
      mainLoopModel: 'claude-haiku-4-5',
    }
    const nextState: AppState = {
      ...oldState,
      mainLoopModel: 'claude-opus-4-5',
    }
    const updateUserSettings = mock(() =>
      settingsWriteResult({ written: true }),
    )
    const setModelOverride = mock(() => {})
    const store = createStore(oldState, args =>
      onChangeAppState(args, {
        updateUserSettings,
        setModelOverride,
        persistProfileModel: mock(() => null),
      }),
    )

    store.setState(() => nextState)

    expect(store.getState()).toBe(nextState)
    expect(updateUserSettings).toHaveBeenCalledWith('userSettings', {
      model: nextState.mainLoopModel,
    })
    expect(setModelOverride).toHaveBeenCalledWith(nextState.mainLoopModel)
  })

  test('accepts a synchronously scoped precommitted model without a duplicate write', () => {
    const oldState: AppState = {
      ...getDefaultAppState(),
      mainLoopModel: 'claude-haiku-4-5',
    }
    const nextState: AppState = {
      ...oldState,
      mainLoopModel: 'claude-opus-4-5',
    }
    const updateUserSettings = mock(() =>
      settingsWriteResult({
        error: new Error('duplicate write must not run'),
        written: false,
      }),
    )
    const setModelOverride = mock(() => {})
    const store = createStore(oldState, args =>
      onChangeAppState(args, {
        updateUserSettings,
        setModelOverride,
        persistProfileModel: mock(() => null),
      }),
    )

    withPrecommittedModelStateUpdate(nextState.mainLoopModel, () => {
      store.setState(() => nextState)
    })

    expect(store.getState()).toBe(nextState)
    expect(updateUserSettings).not.toHaveBeenCalled()
    expect(setModelOverride).toHaveBeenCalledWith(nextState.mainLoopModel)
  })

  test('precommit helper does not advance state when model persistence is rejected', () => {
    const updateState = mock(() => undefined)
    const rejectedUpdate = mock(() =>
      settingsWriteResult({
        error: new Error('settings lock busy'),
        written: false,
      }),
    )

    const result = commitModelStateUpdate(
      'claude-opus-4-1',
      updateState,
      rejectedUpdate,
    )

    expect(result.written).toBe(false)
    expect(updateState).not.toHaveBeenCalled()
  })
})

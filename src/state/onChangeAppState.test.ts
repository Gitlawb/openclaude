import { describe, expect, mock, test } from 'bun:test'
import { type AppState, getDefaultAppState } from './AppStateStore.js'
import { onChangeAppState } from './onChangeAppState.js'
import { createStore } from './store.js'

describe('onChangeAppState model persistence', () => {
  test('keeps the previous model and runtime state when persistence is rejected', () => {
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
        updateUserSettings: mock(() => ({ error: null, written: false })),
        setModelOverride,
        persistProfileModel,
      }),
    )

    store.setState(() => nextState)

    expect(store.getState().mainLoopModel).toBe('claude-haiku-4-5')
    expect(setModelOverride).not.toHaveBeenCalled()
    expect(persistProfileModel).not.toHaveBeenCalled()
  })

  test('accepts a committed model write even when lock cleanup reports an error', () => {
    const oldState: AppState = {
      ...getDefaultAppState(),
      mainLoopModel: 'claude-haiku-4-5',
    }
    const nextState: AppState = {
      ...oldState,
      mainLoopModel: 'claude-opus-4-5',
    }
    const setModelOverride = mock(() => {})
    const store = createStore(oldState, args =>
      onChangeAppState(args, {
        updateUserSettings: mock(() => ({
          error: new Error('lock release failed'),
          written: true,
        })),
        setModelOverride,
      }),
    )

    store.setState(() => nextState)

    expect(store.getState().mainLoopModel).toBe('claude-opus-4-5')
    expect(setModelOverride).toHaveBeenCalledWith('claude-opus-4-5')
  })
})

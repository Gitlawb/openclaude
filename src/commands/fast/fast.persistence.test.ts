import { afterEach, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import {
  updateSettingsForSourceWithFreshSettings,
} from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { clearFastModeModelRestore } from '../../utils/fastMode.js'
import { applyFastMode } from './fast.js'

afterEach(() => {
  clearFastModeModelRestore()
})

test('fast command restores the persisted model and preserves it across a failed disable', () => {
  let settings: SettingsJson = { model: 'model-a' }
  let appState = {
    mainLoopModel: 'model-a',
    mainLoopModelForSession: null,
    fastMode: false,
  } as AppState
  let writeSucceeds = true
  const patches: SettingsJson[] = []
  const setAppState = (update: (previous: AppState) => AppState): void => {
    appState = update(appState)
  }
  const dependencies = {
    updateFresh: (
      _source: Parameters<typeof updateSettingsForSourceWithFreshSettings>[0],
      createPatch: (fresh: SettingsJson) => SettingsJson,
    ) => {
      const patch = createPatch(structuredClone(settings))
      patches.push(patch)
      if (!writeSucceeds) {
        return {
          error: new Error('settings file is locked'),
          written: false,
          committed: false,
        }
      }
      settings = { ...settings, ...patch }
      if (patch.fastMode === undefined) delete settings.fastMode
      return { error: null, written: true, committed: true }
    },
    getFastModel: () => 'fast-model',
    isSupported: (model: string | null) => model === 'fast-model',
    clearCooldown: () => undefined,
  }

  expect(applyFastMode(true, appState.mainLoopModel, setAppState, dependencies)).toBe(true)
  expect(patches.at(-1)).toEqual({ fastMode: true, model: 'fast-model' })
  expect(appState).toMatchObject({
    mainLoopModel: 'fast-model',
    fastMode: true,
  })
  expect(settings).toEqual({ model: 'fast-model', fastMode: true })

  writeSucceeds = false
  expect(applyFastMode(false, appState.mainLoopModel, setAppState, dependencies)).toBe(false)
  expect(patches.at(-1)).toEqual({ fastMode: undefined, model: 'model-a' })
  expect(appState).toMatchObject({
    mainLoopModel: 'fast-model',
    fastMode: true,
  })

  writeSucceeds = true
  expect(applyFastMode(false, appState.mainLoopModel, setAppState, dependencies)).toBe(true)
  expect(patches.at(-1)).toEqual({ fastMode: undefined, model: 'model-a' })
  expect(appState).toMatchObject({ mainLoopModel: 'model-a', fastMode: false })
  expect(settings).toEqual({ model: 'model-a' })
})

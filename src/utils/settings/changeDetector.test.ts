import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { normalize } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { SettingSource } from './constants.js'

type SettingsChangeDetectorModule = typeof import('./changeDetector.js') & {
  _handleChangeForTesting: (path: string) => void
  _handleDeleteForTesting: (path: string) => void
  _setDependenciesForTesting: (overrides?: Record<string, unknown>) => void
}

const pathsBySource: Record<SettingSource, string | null> = {
  userSettings: normalize('/tmp/openclaude/user/settings.json'),
  projectSettings: normalize('/tmp/openclaude/project/.openclaude/settings.json'),
  localSettings: normalize('/tmp/openclaude/project/.openclaude/settings.local.json'),
  flagSettings: null,
  policySettings: normalize('/tmp/openclaude/managed/managed-settings.json'),
}

let resetSettingsCache = mock(() => {})
let consumeInternalWrite = mock(() => false)
let hookResults: { blocked: boolean }[] = []
let executeConfigChangeHooksImpl = async () => hookResults
let executeConfigChangeHooks = mock(async () => hookResults)
let activeDetector: SettingsChangeDetectorModule | null = null

function installMocks(): void {
  resetSettingsCache = mock(() => {})
  consumeInternalWrite = mock(() => false)
  hookResults = []
  executeConfigChangeHooksImpl = async () => hookResults
  executeConfigChangeHooks = mock(() => executeConfigChangeHooksImpl())
}

async function importFreshModule(): Promise<SettingsChangeDetectorModule> {
  activeDetector = (await import(
    `./changeDetector.ts?test=${Date.now()}-${Math.random()}`
  )) as SettingsChangeDetectorModule
  activeDetector._setDependenciesForTesting({
    clearInternalWrites: mock(() => {}),
    consumeInternalWrite,
    executeConfigChangeHooks,
    getManagedSettingsDropInDir: () =>
      normalize('/tmp/openclaude/managed/managed-settings.d'),
    getSettingsFilePathForSource: (source: SettingSource) =>
      pathsBySource[source],
    hasBlockingResult: (results: { blocked: boolean }[]) =>
      results.some(result => result.blocked),
    resetSettingsCache,
  })
  return activeDetector
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/settings/changeDetector.test.ts')
  installMocks()
})

afterEach(async () => {
  try {
    await activeDetector?.resetForTesting()
    activeDetector?._setDependenciesForTesting()
    activeDetector = null
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('settings change detector fanout batching', () => {
  test('debounces rapid filesystem changes and emits each source once', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ settingsDebounce: 5 })

    const emitted: SettingSource[] = []
    const unsubscribe = detector.subscribe(source => {
      emitted.push(source)
    })

    detector._handleChangeForTesting(pathsBySource.userSettings!)
    detector._handleChangeForTesting(pathsBySource.userSettings!)
    detector._handleChangeForTesting(pathsBySource.projectSettings!)

    await sleep(25)

    expect(resetSettingsCache).toHaveBeenCalledTimes(1)
    expect(emitted).toEqual(['userSettings', 'projectSettings'])

    unsubscribe()
    await detector.resetForTesting()
  })

  test('debounces accepted deletion fanout after the deletion grace period', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({
      deletionGrace: 1,
      settingsDebounce: 5,
    })

    const emitted: SettingSource[] = []
    const unsubscribe = detector.subscribe(source => {
      emitted.push(source)
    })

    detector._handleDeleteForTesting(pathsBySource.userSettings!)
    detector._handleDeleteForTesting(pathsBySource.projectSettings!)

    await sleep(30)

    expect(resetSettingsCache).toHaveBeenCalledTimes(1)
    expect(emitted).toEqual(['userSettings', 'projectSettings'])

    unsubscribe()
    await detector.resetForTesting()
  })

  test('does not schedule fanout when a ConfigChange hook blocks a change', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ settingsDebounce: 5 })

    const emitted: SettingSource[] = []
    const unsubscribe = detector.subscribe(source => {
      emitted.push(source)
    })

    hookResults = [{ blocked: true }]
    detector._handleChangeForTesting(pathsBySource.userSettings!)

    await sleep(25)

    expect(resetSettingsCache).not.toHaveBeenCalled()
    expect(emitted).toEqual([])

    unsubscribe()
    await detector.resetForTesting()
  })

  test('suppresses a pending fanout when a newer change for the same source is blocked', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ settingsDebounce: 20 })

    const emitted: SettingSource[] = []
    const unsubscribe = detector.subscribe(source => {
      emitted.push(source)
    })

    hookResults = []
    detector._handleChangeForTesting(pathsBySource.userSettings!)
    await sleep(0)

    hookResults = [{ blocked: true }]
    detector._handleChangeForTesting(pathsBySource.userSettings!)
    await sleep(40)

    expect(resetSettingsCache).not.toHaveBeenCalled()
    expect(emitted).toEqual([])

    unsubscribe()
    await detector.resetForTesting()
  })

  test('suppresses a pending fanout when a same-source deletion is pending hooks', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({
      deletionGrace: 30,
      settingsDebounce: 5,
    })

    const emitted: SettingSource[] = []
    const unsubscribe = detector.subscribe(source => {
      emitted.push(source)
    })

    hookResults = []
    detector._handleChangeForTesting(pathsBySource.userSettings!)
    await sleep(0)

    hookResults = [{ blocked: true }]
    detector._handleDeleteForTesting(pathsBySource.userSettings!)
    await sleep(15)

    expect(resetSettingsCache).not.toHaveBeenCalled()
    expect(emitted).toEqual([])

    await sleep(40)
    expect(resetSettingsCache).not.toHaveBeenCalled()
    expect(emitted).toEqual([])

    unsubscribe()
    await detector.resetForTesting()
  })

  test('dispose prevents in-flight hook results from scheduling fanout', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ settingsDebounce: 5 })

    let releaseHook: (() => void) | undefined
    executeConfigChangeHooksImpl = async () => {
      await new Promise<void>(resolve => {
        releaseHook = resolve
      })
      return hookResults
    }

    const emitted: SettingSource[] = []
    detector.subscribe(source => {
      emitted.push(source)
    })

    detector._handleChangeForTesting(pathsBySource.userSettings!)
    await sleep(0)
    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(1)

    await detector.dispose()
    releaseHook?.()
    await sleep(20)

    expect(resetSettingsCache).not.toHaveBeenCalled()
    expect(emitted).toEqual([])
  })

  test('dispose prevents later change and delete events from running hooks', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({
      deletionGrace: 1,
      settingsDebounce: 5,
    })

    const emitted: SettingSource[] = []
    detector.subscribe(source => {
      emitted.push(source)
    })

    await detector.dispose()
    detector._handleChangeForTesting(pathsBySource.userSettings!)
    detector._handleDeleteForTesting(pathsBySource.projectSettings!)
    await sleep(20)

    expect(executeConfigChangeHooks).not.toHaveBeenCalled()
    expect(resetSettingsCache).not.toHaveBeenCalled()
    expect(emitted).toEqual([])
  })

  test('ignores stale same-source hook completions without dropping newer fanout', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ settingsDebounce: 20 })

    let releaseFirstHook: (() => void) | undefined
    let hookCalls = 0
    executeConfigChangeHooksImpl = async () => {
      hookCalls += 1
      if (hookCalls === 1) {
        await new Promise<void>(resolve => {
          releaseFirstHook = resolve
        })
      }
      return hookResults
    }

    const emitted: SettingSource[] = []
    const unsubscribe = detector.subscribe(source => {
      emitted.push(source)
    })

    detector._handleChangeForTesting(pathsBySource.userSettings!)
    await sleep(0)
    detector._handleChangeForTesting(pathsBySource.userSettings!)
    await sleep(0)

    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(2)
    releaseFirstHook?.()
    await sleep(40)

    expect(resetSettingsCache).toHaveBeenCalledTimes(1)
    expect(emitted).toEqual(['userSettings'])

    unsubscribe()
    await detector.resetForTesting()
  })

  test('resetForTesting clears pending settings fanout timers', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ settingsDebounce: 20 })

    detector._handleChangeForTesting(pathsBySource.userSettings!)
    await sleep(0)
    await detector.resetForTesting({ settingsDebounce: 5 })
    await sleep(30)

    expect(resetSettingsCache).not.toHaveBeenCalled()
  })
})

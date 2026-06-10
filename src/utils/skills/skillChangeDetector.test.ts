import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

type SkillChangeDetectorModule = typeof import('./skillChangeDetector.js') & {
  _scheduleReloadForTesting: (changedPath: string) => void
  _setDependenciesForTesting: (overrides?: Record<string, unknown>) => void
}

let clearCommandsCache = mock(() => {})
let clearCommandMemoizationCaches = mock(() => {})
let clearSkillCaches = mock(() => {})
let resetSentSkillNames = mock(() => {})
let hookResults: { blocked: boolean }[] = []
let executeConfigChangeHooksImpl = async () => hookResults
let executeConfigChangeHooks = mock(async () => hookResults)
let dynamicSkillsLoadedCallback: (() => void) | undefined
let unregisterDynamicSkillsLoaded = mock(() => {})
let getSkillsPathImpl = (_source: string, _dir: string) => ''
let statImpl = mock(async (_path: string) => {})
let chokidarWatch = mock(() => ({
  on: mock(() => {}),
  close: mock(async () => {}),
}))
let activeDetector: SkillChangeDetectorModule | null = null

function installMocks(): void {
  clearCommandsCache = mock(() => {})
  clearCommandMemoizationCaches = mock(() => {})
  clearSkillCaches = mock(() => {})
  resetSentSkillNames = mock(() => {})
  hookResults = []
  executeConfigChangeHooksImpl = async () => hookResults
  executeConfigChangeHooks = mock(() => executeConfigChangeHooksImpl())
  dynamicSkillsLoadedCallback = undefined
  unregisterDynamicSkillsLoaded = mock(() => {})
  getSkillsPathImpl = () => ''
  statImpl = mock(async () => {})
  chokidarWatch = mock(() => ({
    on: mock(() => {}),
    close: mock(async () => {}),
  }))
}

async function importFreshModule(): Promise<SkillChangeDetectorModule> {
  activeDetector = (await import(
    `./skillChangeDetector.ts?test=${Date.now()}-${Math.random()}`
  )) as SkillChangeDetectorModule
  activeDetector._setDependenciesForTesting({
    clearCommandMemoizationCaches,
    clearCommandsCache,
    executeConfigChangeHooks,
    getFsImplementation: () => ({
      stat: statImpl,
    }),
    getSkillsPath: (source: string, dir: string) =>
      getSkillsPathImpl(source, dir),
    hasBlockingResult: (results: { blocked: boolean }[]) =>
      results.some(result => result.blocked),
    onDynamicSkillsLoaded: (callback: () => void) => {
      dynamicSkillsLoadedCallback = callback
      return unregisterDynamicSkillsLoaded
    },
    resetSentSkillNames,
    watch: chokidarWatch,
  })
  return activeDetector
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/skills/skillChangeDetector.test.ts')
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

describe('skillChangeDetector reload batching', () => {
  test('dispose unregisters and guards dynamic skill callbacks', async () => {
    const detector = await importFreshModule()

    let notifications = 0
    detector.subscribe(() => {
      notifications += 1
    })

    await detector.initialize()
    expect(dynamicSkillsLoadedCallback).toBeDefined()

    await detector.dispose()
    dynamicSkillsLoadedCallback?.()

    expect(unregisterDynamicSkillsLoaded).toHaveBeenCalledTimes(1)
    expect(clearCommandMemoizationCaches).not.toHaveBeenCalled()
    expect(notifications).toBe(0)
  })

  test('dispose during initialize prevents watcher creation after path lookup resolves', async () => {
    const detector = await importFreshModule()
    getSkillsPathImpl = (source, dir) =>
      source === 'userSettings' && dir === 'skills' ? '/tmp/skills' : ''

    let resolveStat: (() => void) | undefined
    statImpl = mock(
      async () =>
        await new Promise<void>(resolve => {
          resolveStat = resolve
        }),
    )

    const initializePromise = detector.initialize()
    await sleep(0)
    await detector.dispose()
    resolveStat?.()
    await initializePromise

    expect(chokidarWatch).not.toHaveBeenCalled()
  })

  test('batches rapid reload requests into one hook/cache clear/notification', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ reloadDebounce: 5, reloadCooldown: 20 })

    let notifications = 0
    const unsubscribe = detector.subscribe(() => {
      notifications += 1
    })

    detector._scheduleReloadForTesting('/tmp/skills/a/SKILL.md')
    detector._scheduleReloadForTesting('/tmp/skills/b/SKILL.md')
    detector._scheduleReloadForTesting('/tmp/skills/c/SKILL.md')

    await sleep(30)

    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(1)
    expect(clearCommandsCache).toHaveBeenCalledTimes(1)
    expect(clearSkillCaches).not.toHaveBeenCalled()
    expect(resetSentSkillNames).toHaveBeenCalledTimes(1)
    expect(notifications).toBe(1)

    unsubscribe()
    await detector.resetForTesting()
  })

  test('delays a second burst until the reload cooldown has elapsed', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ reloadDebounce: 5, reloadCooldown: 60 })

    let notifications = 0
    const unsubscribe = detector.subscribe(() => {
      notifications += 1
    })

    detector._scheduleReloadForTesting('/tmp/skills/first/SKILL.md')
    await sleep(20)
    expect(notifications).toBe(1)

    detector._scheduleReloadForTesting('/tmp/skills/second/SKILL.md')
    await sleep(20)
    expect(notifications).toBe(1)

    await sleep(60)
    expect(notifications).toBe(2)
    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(2)

    unsubscribe()
    await detector.resetForTesting()
  })

  test('does not start cooldown when a ConfigChange hook blocks reload', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ reloadDebounce: 5, reloadCooldown: 500 })

    let notifications = 0
    const unsubscribe = detector.subscribe(() => {
      notifications += 1
    })

    hookResults = [{ blocked: true }]
    detector._scheduleReloadForTesting('/tmp/skills/blocked/SKILL.md')
    await sleep(20)
    expect(notifications).toBe(0)
    expect(clearCommandsCache).not.toHaveBeenCalled()

    hookResults = []
    detector._scheduleReloadForTesting('/tmp/skills/allowed/SKILL.md')
    await sleep(20)

    expect(notifications).toBe(1)
    expect(clearCommandsCache).toHaveBeenCalledTimes(1)

    unsubscribe()
    await detector.resetForTesting()
  })

  test('queues events during an in-flight reload before cache clear and notification', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ reloadDebounce: 5, reloadCooldown: 60 })

    let releaseFirstHook: (() => void) | undefined
    let releaseSecondHook: (() => void) | undefined
    let hookCalls = 0
    executeConfigChangeHooksImpl = async () => {
      hookCalls += 1
      if (hookCalls === 1) {
        await new Promise<void>(resolve => {
          releaseFirstHook = resolve
        })
      } else if (hookCalls === 2) {
        await new Promise<void>(resolve => {
          releaseSecondHook = resolve
        })
      }
      return hookResults
    }

    let notifications = 0
    const unsubscribe = detector.subscribe(() => {
      notifications += 1
    })

    detector._scheduleReloadForTesting('/tmp/skills/first/SKILL.md')
    await sleep(20)
    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(1)

    detector._scheduleReloadForTesting('/tmp/skills/second/SKILL.md')
    await sleep(30)
    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(1)

    releaseFirstHook?.()
    await sleep(20)
    expect(notifications).toBe(0)
    expect(clearCommandsCache).not.toHaveBeenCalled()
    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(2)

    releaseSecondHook?.()
    await sleep(30)
    expect(notifications).toBe(1)
    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(2)

    unsubscribe()
    await detector.resetForTesting()
  })

  test('dispose prevents an in-flight reload from clearing caches after hook resolution', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ reloadDebounce: 5, reloadCooldown: 20 })

    let releaseHook: (() => void) | undefined
    executeConfigChangeHooksImpl = async () => {
      await new Promise<void>(resolve => {
        releaseHook = resolve
      })
      return hookResults
    }

    let notifications = 0
    detector.subscribe(() => {
      notifications += 1
    })

    detector._scheduleReloadForTesting('/tmp/skills/in-flight/SKILL.md')
    await sleep(20)
    expect(executeConfigChangeHooks).toHaveBeenCalledTimes(1)

    await detector.dispose()
    releaseHook?.()
    await sleep(20)

    expect(clearCommandsCache).not.toHaveBeenCalled()
    expect(resetSentSkillNames).not.toHaveBeenCalled()
    expect(notifications).toBe(0)
  })

  test('dispose prevents later reload scheduling from running hooks', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ reloadDebounce: 5, reloadCooldown: 20 })

    let notifications = 0
    detector.subscribe(() => {
      notifications += 1
    })

    await detector.dispose()
    detector._scheduleReloadForTesting('/tmp/skills/after-dispose/SKILL.md')
    await sleep(20)

    expect(executeConfigChangeHooks).not.toHaveBeenCalled()
    expect(clearCommandsCache).not.toHaveBeenCalled()
    expect(notifications).toBe(0)
  })

  test('resetForTesting clears pending reload timers', async () => {
    const detector = await importFreshModule()
    await detector.resetForTesting({ reloadDebounce: 20, reloadCooldown: 20 })

    detector._scheduleReloadForTesting('/tmp/skills/pending/SKILL.md')
    await detector.resetForTesting({ reloadDebounce: 5, reloadCooldown: 5 })
    await sleep(30)

    expect(executeConfigChangeHooks).not.toHaveBeenCalled()
    expect(clearCommandsCache).not.toHaveBeenCalled()
  })
})

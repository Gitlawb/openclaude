import { expect, test } from 'bun:test'
import {
  assertHeadlessPluginPreparationReady,
  createSettingsDownloadCoordinator,
  handleReloadSettingsDownloadResult,
  handleSettingsDownloadResult,
  prepareHeadlessPluginsAfterSettingsDownload,
  type SettingsDownloadResult,
} from './downloadLifecycle.js'

const completeResult = (
  settingsSourcesWritten: SettingsDownloadResult['settingsSourcesWritten'] = [],
): SettingsDownloadResult => ({
  complete: true,
  failureKind: null,
  settingsSourcesWritten,
})

test('a redownload supersedes the cached generation and older waiters join it', async () => {
  let finishStartup: ((value: SettingsDownloadResult) => void) | undefined
  let finishRedownload: ((value: SettingsDownloadResult) => void) | undefined
  const currentChecks: boolean[] = []
  const coordinator = createSettingsDownloadCoordinator(
    3,
    (maxRetries, isCurrent) =>
      new Promise<SettingsDownloadResult>(resolve => {
        const finish = (value: SettingsDownloadResult) => {
          currentChecks.push(isCurrent())
          resolve(value)
        }
        if (maxRetries === 0) finishRedownload = finish
        else finishStartup = finish
      }),
  )

  const startup = coordinator.download()
  const redownload = coordinator.redownload()
  finishRedownload!(completeResult(['userSettings']))
  const current = await redownload
  const joined = await startup
  finishStartup!(completeResult())
  await Promise.resolve()

  expect(joined).toBe(current)
  expect(currentChecks).toEqual([true, false])
})

test('a superseded rejecting runner is observed while its waiter follows the replacement', async () => {
  let rejectStartup: ((error: Error) => void) | undefined
  let finishRedownload: ((value: SettingsDownloadResult) => void) | undefined
  const coordinator = createSettingsDownloadCoordinator(
    3,
    maxRetries =>
      new Promise<SettingsDownloadResult>((resolve, reject) => {
        if (maxRetries === 0) finishRedownload = resolve
        else rejectStartup = reject
      }),
  )

  const startup = coordinator.download()
  const redownload = coordinator.redownload()
  const replacement = completeResult(['userSettings'])
  finishRedownload!(replacement)
  expect(await startup).toBe(replacement)
  expect(await redownload).toBe(replacement)
  rejectStartup!(new Error('late startup failure'))
  await Promise.resolve()
})

test('a current rejecting runner rejects its waiter', async () => {
  const coordinator = createSettingsDownloadCoordinator(3, async () => {
    throw new Error('runner failed')
  })

  await expect(coordinator.download()).rejects.toThrow('runner failed')
})

test('reset detaches an in-flight waiter and makes the next download fresh', async () => {
  const finishes: Array<(value: SettingsDownloadResult) => void> = []
  const coordinator = createSettingsDownloadCoordinator(
    3,
    () =>
      new Promise<SettingsDownloadResult>(resolve => {
        finishes.push(resolve)
      }),
  )

  const beforeReset = coordinator.download()
  coordinator.reset()
  const afterReset = coordinator.download()
  finishes[0]!(completeResult(['localSettings']))
  finishes[1]!(completeResult(['userSettings']))

  expect(await beforeReset).toEqual(completeResult(['localSettings']))
  expect(await afterReset).toEqual(completeResult(['userSettings']))
  expect(beforeReset).not.toBe(afterReset)
})

test.each([
  {
    name: 'post-fetch preparation failure',
    result: {
      complete: false,
      failureKind: 'prepare_failed',
      settingsSourcesWritten: [],
    } satisfies SettingsDownloadResult,
    expected: { ready: false, notified: [], installed: 0, mcp: 0 },
  },
  {
    name: 'complete settings apply',
    result: completeResult(['userSettings']),
    expected: { ready: true, notified: ['userSettings'], installed: 1, mcp: 1 },
  },
  {
    name: 'total fetch failure',
    result: {
      complete: false,
      failureKind: 'fetch_failed',
      settingsSourcesWritten: [],
    } satisfies SettingsDownloadResult,
    expected: { ready: true, notified: [], installed: 1, mcp: 1 },
  },
  {
    name: 'partial settings apply',
    result: {
      complete: false,
      failureKind: 'apply_failed',
      settingsSourcesWritten: ['localSettings'],
    } satisfies SettingsDownloadResult,
    expected: {
      ready: false,
      notified: ['localSettings'],
      installed: 0,
      mcp: 0,
    },
  },
  {
    name: 'settings lock contention',
    result: {
      complete: false,
      failureKind: 'apply_failed',
      settingsSourcesWritten: [],
    } satisfies SettingsDownloadResult,
    expected: { ready: false, notified: [], installed: 0, mcp: 0 },
  },
] as const)(
  'headless plugin preparation handles $name explicitly',
  async ({ result, expected }) => {
    const notified: string[] = []
    let installed = 0
    let mcp = 0
    const outcome = await prepareHeadlessPluginsAfterSettingsDownload({
      downloadSettings: async () => result,
      waitForManagedSettings: async () => {},
      notify: source => notified.push(source),
      installPlugins: async () => {
        installed++
        return true
      },
      applyPluginMcp: async () => {
        mcp++
      },
    })

    expect(outcome.ready).toBe(expected.ready)
    expect(notified).toEqual([...expected.notified])
    expect(installed).toBe(expected.installed)
    expect(mcp).toBe(expected.mcp)
  },
)

test('strict reload policy blocks a total fetch failure with accurate classification', () => {
  const decision = handleSettingsDownloadResult(
    {
      complete: false,
      failureKind: 'fetch_failed',
      settingsSourcesWritten: [],
    },
    { notify() {}, failOpenOnFetchFailure: false },
  )

  expect(decision).toMatchObject({
    proceed: false,
    failureKind: 'fetch_failed',
    error: expect.objectContaining({
      message: 'Remote settings could not be downloaded',
    }),
  })
})

test.each([
  ['fetch_failed', true],
  ['prepare_failed', false],
  ['apply_failed', false],
] as const)(
  'shared SDK/slash reload policy handles %s with proceed=%s',
  (failureKind, proceed) => {
    const decision = handleReloadSettingsDownloadResult(
      { complete: false, failureKind, settingsSourcesWritten: [] },
      () => {},
    )
    expect(decision.proceed).toBe(proceed)
    expect(decision.failureKind).toBe(failureKind)
  },
)

test('synchronous plugin preparation throws before refresh after a partial apply', async () => {
  const result = await prepareHeadlessPluginsAfterSettingsDownload({
    downloadSettings: async () => ({
      complete: false,
      failureKind: 'apply_failed',
      settingsSourcesWritten: ['userSettings'],
    }),
    waitForManagedSettings: async () => {},
    notify() {},
    installPlugins: async () => true,
    applyPluginMcp: async () => {},
  })
  let refreshed = false

  expect(() => {
    assertHeadlessPluginPreparationReady(result)
    refreshed = true
  }).toThrow('Remote settings were only partially applied')
  expect(refreshed).toBe(false)
})

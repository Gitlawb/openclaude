import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import type { SettingsSyncFetchResult } from '../../services/settingsSync/types.js'

const originalCwd = process.cwd()
const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-settings-sync-partial-')),
)
const scenario = process.argv[2] ?? 'settings-partial'

try {
  process.chdir(configDir)
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()

  const { __test } = await import('../../services/settingsSync/index.js')
  const { SYNC_KEYS } = await import('../../services/settingsSync/types.js')
  const { getMemoryPath } = await import('../../utils/config.js')
  const {
    getSettingsFilePathForSource,
    getSettingsForSource,
  } = await import('../../utils/settings/settings.js')
  const { withSettingsFileLockSync } = await import(
    '../../utils/settings/settingsFileLock.js'
  )
  const { resetSettingsCache } = await import(
    '../../utils/settings/settingsCache.js'
  )

  if (scenario === 'supersession') {
    const settingsPath = getSettingsFilePathForSource('userSettings')!
    writeFileSync(settingsPath, '{"env":{"VALUE":"initial"}}\n', 'utf8')
    let resolveStartup: ((value: SettingsSyncFetchResult) => void) | undefined
    let resolveRedownload: typeof resolveStartup
    const coordinator = __test.createDownloadCoordinator({
      shouldDownload: () => true,
      isEligible: () => true,
      fetchUserSettings: maxRetries =>
        new Promise(resolve => {
          if (maxRetries === 0) resolveRedownload = resolve
          else resolveStartup = resolve
        }),
      getRepoRemoteHash: async () => null,
      applyRemoteEntriesToLocal: __test.applyRemoteEntriesToLocal,
    })

    const startup = coordinator.download()
    const redownload = coordinator.redownload()
    resolveRedownload!(settingsFetchResult(SYNC_KEYS.USER_SETTINGS, 'new'))
    const redownloadResult = await redownload
    const startupResult = await startup
    resolveStartup!(settingsFetchResult(SYNC_KEYS.USER_SETTINGS, 'stale'))
    await new Promise<void>(resolve => setImmediate(resolve))

    process.stdout.write(
      JSON.stringify({
        finalValue: JSON.parse(readFileSync(settingsPath, 'utf8')).env.VALUE,
        sameResult: startupResult === redownloadResult,
        redownloadResult,
      }),
    )
  } else if (scenario === 'supersession-inflight') {
    const settingsPath = getSettingsFilePathForSource('userSettings')!
    writeFileSync(settingsPath, '{"env":{"VALUE":"initial"}}\n', 'utf8')
    let resolveStartupFetch:
      | ((value: SettingsSyncFetchResult) => void)
      | undefined
    let resolveRedownloadFetch: typeof resolveStartupFetch
    let markStartupApplyStarted: () => void
    const startupApplyStarted = new Promise<void>(resolve => {
      markStartupApplyStarted = resolve
    })
    let releaseStartupApply: () => void
    const startupApplyGate = new Promise<void>(resolve => {
      releaseStartupApply = resolve
    })
    const applyEvents: string[] = []
    const coordinator = __test.createDownloadCoordinator({
      shouldDownload: () => true,
      isEligible: () => true,
      fetchUserSettings: maxRetries =>
        new Promise(resolve => {
          if (maxRetries === 0) resolveRedownloadFetch = resolve
          else resolveStartupFetch = resolve
        }),
      getRepoRemoteHash: async () => null,
      applyRemoteEntriesToLocal: async entries => {
        const value = JSON.parse(entries[SYNC_KEYS.USER_SETTINGS]!).env.VALUE
        applyEvents.push(`started:${value}`)
        if (value === 'stale') {
          markStartupApplyStarted!()
          await startupApplyGate
        }
        writeFileSync(
          settingsPath,
          `${JSON.stringify({ env: { VALUE: value } })}\n`,
          'utf8',
        )
        applyEvents.push(`finished:${value}`)
        return {
          complete: true,
          failureKind: null,
          settingsSourcesWritten: ['userSettings'],
        }
      },
    })

    const startup = coordinator.download()
    resolveStartupFetch!(
      settingsFetchResult(SYNC_KEYS.USER_SETTINGS, 'stale'),
    )
    await startupApplyStarted
    const redownload = coordinator.redownload()
    resolveRedownloadFetch!(settingsFetchResult(SYNC_KEYS.USER_SETTINGS, 'new'))
    await new Promise<void>(resolve => setImmediate(resolve))
    const newerStartedBeforeRelease = applyEvents.includes('started:new')
    releaseStartupApply!()
    const redownloadResult = await redownload
    const startupResult = await startup

    process.stdout.write(
      JSON.stringify({
        applyEvents,
        finalValue: JSON.parse(readFileSync(settingsPath, 'utf8')).env.VALUE,
        newerStartedBeforeRelease,
        sameResult: startupResult === redownloadResult,
      }),
    )
  } else if (scenario === 'settings-partial') {
    const userPath = getSettingsFilePathForSource('userSettings')!
    const localPath = getSettingsFilePathForSource('localSettings')!
    const originalLocal = '{}\n'
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(userPath, '{"env":{"CACHED":"old"}}\n', 'utf8')
    writeFileSync(localPath, originalLocal, 'utf8')
    resetSettingsCache()
    getSettingsForSource('userSettings')

    let applyPromise:
      | ReturnType<typeof __test.applyRemoteEntriesToLocal>
      | undefined
    withSettingsFileLockSync(localPath, () => {
      applyPromise = __test.applyRemoteEntriesToLocal(
        {
          [SYNC_KEYS.USER_SETTINGS]: '{"env":{"REMOTE":"yes"}}\n',
          [SYNC_KEYS.projectSettings('project')]:
            '{"env":{"LOCAL":"blocked"}}\n',
        },
        'project',
      )
    })
    if (!applyPromise) throw new Error('Settings sync did not start')
    const result = await applyPromise

    process.stdout.write(
      JSON.stringify({
        result,
        userLanded: readFileSync(userPath, 'utf8').includes('REMOTE'),
        localUnchanged: readFileSync(localPath, 'utf8') === originalLocal,
        cachedUser: getSettingsForSource('userSettings')?.env?.REMOTE,
      }),
    )
  } else {
    const isUserMemory = scenario.startsWith('user-')
    const isProjectMemory = scenario.startsWith('project-')
    const isOversized = scenario.endsWith('-oversized')
    if (!isUserMemory && !isProjectMemory) {
      throw new Error(`Unknown settings sync scenario: ${scenario}`)
    }

    const memoryPath = getMemoryPath(isUserMemory ? 'User' : 'Local')
    if (!isOversized) {
      mkdirSync(memoryPath, { recursive: true })
    }
    const memoryKey = isUserMemory
      ? SYNC_KEYS.USER_MEMORY
      : SYNC_KEYS.projectMemory('project')
    const result = await __test.applyRemoteEntriesToLocal(
      {
        [SYNC_KEYS.USER_SETTINGS]: '{"env":{"REMOTE":"yes"}}\n',
        [memoryKey]: isOversized ? 'x'.repeat(500 * 1024 + 1) : 'remote',
      },
      'project',
    )
    const userPath = getSettingsFilePathForSource('userSettings')!
    process.stdout.write(
      JSON.stringify({
        result,
        settingsLanded: readFileSync(userPath, 'utf8').includes('REMOTE'),
      }),
    )
  }
} finally {
  process.chdir(originalCwd)
  rmSync(configDir, { recursive: true, force: true })
}

function settingsFetchResult(
  key: string,
  value: string,
): SettingsSyncFetchResult {
  return {
    success: true,
    isEmpty: false,
    data: {
      userId: 'user',
      version: 1,
      lastModified: '2026-08-16T00:00:00Z',
      checksum: value,
      content: {
        entries: {
          [key]: `${JSON.stringify({ env: { VALUE: value } })}\n`,
        },
      },
    },
  }
}

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
const lockHolderFixture = join(import.meta.dir, 'settingsLockHolder.fixture.ts')

async function waitForFile(path: string, description: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (true) {
    try {
      readFileSync(path)
      return
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${description}`)
      }
      await Bun.sleep(10)
    }
  }
}

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

    // fetchUserSettings runs synchronously up to its first await. The startup
    // waiter is then superseded and follows the redownload result without
    // waiting for the stale fetch to settle.
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
  } else if (scenario === 'supersession-after-apply-fetch-fail') {
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
        markStartupApplyStarted!()
        await startupApplyGate
        writeFileSync(
          settingsPath,
          entries[SYNC_KEYS.USER_SETTINGS]!,
          'utf8',
        )
        return {
          complete: false,
          failureKind: 'apply_failed',
          settingsSourcesWritten: ['userSettings'],
        }
      },
    })

    const startup = coordinator.download()
    resolveStartupFetch!(
      settingsFetchResult(SYNC_KEYS.USER_SETTINGS, 'applied-by-startup'),
    )
    await startupApplyStarted
    const redownload = coordinator.redownload()
    resolveRedownloadFetch!({ success: false, error: 'offline' })
    const redownloadResult = await redownload
    releaseStartupApply!()
    const startupResult = await startup

    process.stdout.write(
      JSON.stringify({
        finalValue: JSON.parse(readFileSync(settingsPath, 'utf8')).env.VALUE,
        redownloadResult,
        startupResult,
      }),
    )
  } else if (scenario === 'prepare-failure') {
    const coordinator = __test.createDownloadCoordinator({
      shouldDownload: () => true,
      isEligible: () => true,
      fetchUserSettings: async () =>
        settingsFetchResult(SYNC_KEYS.USER_SETTINGS, 'never-applied'),
      getRepoRemoteHash: async () => {
        throw new Error('project id unavailable')
      },
      applyRemoteEntriesToLocal: async () => {
        throw new Error('apply must not run')
      },
    })
    process.stdout.write(JSON.stringify(await coordinator.download()))
  } else if (scenario === 'settings-partial') {
    const userPath = getSettingsFilePathForSource('userSettings')!
    const localPath = getSettingsFilePathForSource('localSettings')!
    const originalLocal = '{}\n'
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(userPath, '{"env":{"CACHED":"old"}}\n', 'utf8')
    writeFileSync(localPath, originalLocal, 'utf8')
    resetSettingsCache()
    getSettingsForSource('userSettings')

    const readyMarker = join(configDir, 'local-lock-ready')
    const releaseMarker = join(configDir, 'local-lock-release')
    const lockHolder = Bun.spawn(
      [
        process.execPath,
        lockHolderFixture,
        localPath,
        readyMarker,
        releaseMarker,
      ],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' },
    )
    try {
      await waitForFile(readyMarker, 'local settings lock holder')
      const result = await __test.applyRemoteEntriesToLocal(
        {
          [SYNC_KEYS.USER_SETTINGS]: '{"env":{"REMOTE":"yes"}}\n',
          [SYNC_KEYS.projectSettings('project')]:
            '{"env":{"LOCAL":"blocked"}}\n',
        },
        'project',
      )
      writeFileSync(releaseMarker, 'release', 'utf8')
      const [holderStdout, holderStderr, holderExitCode] = await Promise.all([
        new Response(lockHolder.stdout).text(),
        new Response(lockHolder.stderr).text(),
        lockHolder.exited,
      ])
      if (holderExitCode !== 0) {
        throw new Error(
          `Settings lock holder failed (${holderExitCode}): ${holderStderr || holderStdout}`,
        )
      }

      process.stdout.write(
        JSON.stringify({
          result,
          userLanded: readFileSync(userPath, 'utf8').includes('REMOTE'),
          localUnchanged: readFileSync(localPath, 'utf8') === originalLocal,
          cachedUser: getSettingsForSource('userSettings')?.env?.REMOTE,
        }),
      )
    } finally {
      if (!lockHolder.killed && lockHolder.exitCode === null) {
        writeFileSync(releaseMarker, 'release', 'utf8')
        await lockHolder.exited
      }
    }
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

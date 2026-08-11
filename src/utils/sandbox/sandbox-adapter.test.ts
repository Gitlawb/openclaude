import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import {
  getCwdState,
  getOriginalCwd,
  setCwdState,
  setOriginalCwd,
} from '../../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
} from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { withSettingsFileLockSync } from '../settings/settingsFileLock.js'
import type { SettingsJson } from '../settings/types.js'
import {
  addToExcludedCommands,
  convertToSandboxRuntimeConfig,
  SandboxManager,
} from './sandbox-adapter.js'

describe('sandbox settings persistence', () => {
  let previousOriginalCwd: string
  let tempRoot: string

  beforeEach(async () => {
    await acquireSharedMutationLock('utils/sandbox/sandbox-adapter.test.ts')
    previousOriginalCwd = getOriginalCwd()
    tempRoot = mkdtempSync(join(tmpdir(), 'openclaude-sandbox-persistence-'))
    mkdirSync(join(tempRoot, '.openclaude'), { recursive: true })
    setOriginalCwd(tempRoot)
    resetSettingsCache()
  })

  afterEach(() => {
    try {
      setOriginalCwd(previousOriginalCwd)
      resetSettingsCache()
      rmSync(tempRoot, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('rejects when the settings update does not reach disk', async () => {
    const settingsPath = getSettingsFilePathForSource('localSettings')!
    let updatePromise: Promise<void> | undefined

    withSettingsFileLockSync(settingsPath, () => {
      updatePromise = SandboxManager.setSandboxSettings({ enabled: true })
    })

    expect(updatePromise).toBeDefined()
    await expect(updatePromise!).rejects.toThrow('Failed to update settings')
  })

  test('a cached exclusion still verifies the fresh file under the lock', () => {
    const settingsPath = getSettingsFilePathForSource('localSettings')!
    writeFileSync(
      settingsPath,
      `${JSON.stringify({ sandbox: { excludedCommands: ['npm test'] } }, null, 2)}\n`,
      'utf8',
    )
    resetSettingsCache()

    expect(() =>
      withSettingsFileLockSync(settingsPath, () => {
        addToExcludedCommands('npm test')
      }),
    ).toThrow('already being held')
  })

  test('a stale cached exclusion is restored after a peer removes it', () => {
    const settingsPath = getSettingsFilePathForSource('localSettings')!
    writeFileSync(
      settingsPath,
      `${JSON.stringify({ sandbox: { excludedCommands: ['npm test'] } }, null, 2)}\n`,
      'utf8',
    )
    resetSettingsCache()

    expect(getSettingsForSource('localSettings')?.sandbox?.excludedCommands).toEqual([
      'npm test',
    ])
    writeFileSync(settingsPath, '{}\n', 'utf8')

    expect(addToExcludedCommands('npm test')).toBe('npm test')
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      sandbox: { excludedCommands: ['npm test'] },
    })
  })

  test('a fresh no-op invalidates the stale per-source cache', () => {
    const settingsPath = getSettingsFilePathForSource('localSettings')!
    writeFileSync(
      settingsPath,
      `${JSON.stringify({ sandbox: { excludedCommands: ['cached'] } }, null, 2)}\n`,
      'utf8',
    )
    resetSettingsCache()
    expect(getSettingsForSource('localSettings')?.sandbox?.excludedCommands).toEqual([
      'cached',
    ])

    writeFileSync(
      settingsPath,
      `${JSON.stringify({ sandbox: { excludedCommands: ['npm test'] } }, null, 2)}\n`,
      'utf8',
    )
    expect(addToExcludedCommands('npm test')).toBe('npm test')

    expect(getSettingsForSource('localSettings')?.sandbox?.excludedCommands).toEqual([
      'npm test',
    ])
  })
})

describe('convertToSandboxRuntimeConfig', () => {
  let previousConfigDir: string | undefined
  let previousOriginalCwd: string
  let previousCwd: string
  let tempRoot: string
  let activeCwd: string

  beforeEach(async () => {
    await acquireSharedMutationLock('utils/sandbox/sandbox-adapter.test.ts')

    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    previousOriginalCwd = getOriginalCwd()
    previousCwd = getCwdState()

    tempRoot = await mkdtemp(join(tmpdir(), 'openclaude-sandbox-adapter-'))
    const originalCwd = join(tempRoot, 'original-project')
    activeCwd = join(tempRoot, 'active-project')

    process.env.CLAUDE_CONFIG_DIR = join(tempRoot, 'config')
    resetSettingsCache()
    setOriginalCwd(originalCwd)
    setCwdState(activeCwd)
  })

  afterEach(async () => {
    try {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir
      }
      setOriginalCwd(previousOriginalCwd)
      setCwdState(previousCwd)
      resetSettingsCache()
      await rm(tempRoot, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('denies canonical OpenClaude settings files in changed cwd', () => {
    const config = convertToSandboxRuntimeConfig({} as SettingsJson)

    expect(config.filesystem.denyWrite).toContain(
      resolve(activeCwd, '.openclaude', 'settings.json'),
    )
    expect(config.filesystem.denyWrite).toContain(
      resolve(activeCwd, '.openclaude', 'settings.local.json'),
    )
  })

  test('denies legacy Claude config surfaces in original and changed cwd', () => {
    const config = convertToSandboxRuntimeConfig({} as SettingsJson)

    for (const cwd of [getOriginalCwd(), activeCwd]) {
      expect(config.filesystem.denyWrite).toContain(
        resolve(cwd, '.claude'),
      )
    }
  })

  test('denies legacy Claude config surfaces from CLAUDE_CONFIG_DIR', () => {
    const config = convertToSandboxRuntimeConfig({} as SettingsJson)
    const configDir = process.env.CLAUDE_CONFIG_DIR!

    expect(config.filesystem.denyWrite).toContain(resolve(configDir))
  })

  test('root deny covers non-settings legacy Claude state', () => {
    const config = convertToSandboxRuntimeConfig({} as SettingsJson)

    const representativeLegacyPaths = [
      resolve(getOriginalCwd(), '.claude', 'CLAUDE.md'),
      resolve(activeCwd, '.claude', 'credentials.json'),
      resolve(process.env.CLAUDE_CONFIG_DIR!, 'plugins', 'plugin.json'),
      resolve(process.env.CLAUDE_CONFIG_DIR!, 'scheduled-tasks', 'task.json'),
    ]

    for (const legacyPath of representativeLegacyPaths) {
      expect(
        config.filesystem.denyWrite.some(
          deniedRoot =>
            legacyPath === deniedRoot ||
            legacyPath.startsWith(`${deniedRoot}${sep}`),
        ),
      ).toBe(true)
    }
  })
})

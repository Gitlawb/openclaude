import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
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
import { resetSettingsCache } from '../settings/settingsCache.js'
import type { SettingsJson } from '../settings/types.js'
import { convertToSandboxRuntimeConfig } from './sandbox-adapter.js'

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

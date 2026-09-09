import { afterEach, describe, expect, mock, test } from 'bun:test'
import * as fsPromises from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { acquireEnvMutex, releaseEnvMutex } from '../entrypoints/sdk/shared.js'

const originalEnv = { ...process.env }
const originalArgv = [...process.argv]

async function importFreshEnvUtils() {
  return import(`./envUtils.ts?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshSettings() {
  return import(`./settings/settings.ts?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshLocalInstaller() {
  return import(`./localInstaller.ts?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshPlans() {
  return import(`./plans.ts?ts=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    process.argv = [...originalArgv]
    mock.restore()
  } finally {
    releaseEnvMutex()
  }
})

describe('Verboo paths', () => {
  test('defaults user config home to ~/.verboo', async () => {
    await acquireEnvMutex()
    delete process.env.VERBOO_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    const { resolveClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(resolveClaudeConfigHomeDir({ homeDir: homedir() })).toBe(
      join(homedir(), '.verboo'),
    )
  })

  test('ignores CLAUDE_CONFIG_DIR and uses VERBOO_CONFIG_DIR only', async () => {
    await acquireEnvMutex()
    process.env.CLAUDE_CONFIG_DIR = '/tmp/should-be-ignored'
    process.env.VERBOO_CONFIG_DIR = '/tmp/custom-verboo'
    const { getClaudeConfigHomeDir, resolveClaudeConfigHomeDir } =
      await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/custom-verboo')
    expect(
      resolveClaudeConfigHomeDir({
        configDirEnv: process.env.VERBOO_CONFIG_DIR,
      }),
    ).toBe('/tmp/custom-verboo')
  })

  test('default plans directory uses ~/.verboo/plans', async () => {
    await acquireEnvMutex()
    delete process.env.VERBOO_CONFIG_DIR
    const { getDefaultPlansDirectory } = await importFreshPlans()

    expect(getDefaultPlansDirectory({ homeDir: homedir() })).toBe(
      join(homedir(), '.verboo', 'plans'),
    )
  })

  test('project and local settings paths use .verboo', async () => {
    await acquireEnvMutex()
    const { getRelativeSettingsFilePathForSource } = await importFreshSettings()

    expect(getRelativeSettingsFilePathForSource('projectSettings')).toBe(
      '.verboo/settings.json',
    )
    expect(getRelativeSettingsFilePathForSource('localSettings')).toBe(
      '.verboo/settings.local.json',
    )
  })

  test('local installer uses verboo wrapper path', async () => {
    await acquireEnvMutex()
    process.env.VERBOO_CONFIG_DIR = join(homedir(), '.verboo')
    const { getLocalClaudePath } = await importFreshLocalInstaller()

    expect(getLocalClaudePath()).toBe(
      join(homedir(), '.verboo', 'local', 'verboo'),
    )
  })

  test('local installation detection matches .verboo path only', async () => {
    process.env.VERBOO_CONFIG_DIR = join(homedir(), '.verboo')
    await acquireEnvMutex()
    const { isManagedLocalInstallationPath } =
      await importFreshLocalInstaller()

    expect(
      isManagedLocalInstallationPath(
        `${join(homedir(), '.verboo', 'local')}/node_modules/.bin/verboo`,
      ),
    ).toBe(true)
  })

  test('candidate local install dirs include only Verboo path', async () => {
    await acquireEnvMutex()
    const { getCandidateLocalInstallDirs } = await importFreshLocalInstaller()

    expect(
      getCandidateLocalInstallDirs({
        configHomeDir: join(homedir(), '.verboo'),
        homeDir: homedir(),
      }),
    ).toEqual([join(homedir(), '.verboo', 'local')])
  })

  test('local installs are detected when they expose the verboo binary', async () => {
    process.env.VERBOO_CONFIG_DIR = join(homedir(), '.verboo')
    await acquireEnvMutex()
    mock.module('fs/promises', () => ({
      ...fsPromises,
      access: async (path: string) => {
        if (
          path === join(homedir(), '.verboo', 'local', 'node_modules', '.bin', 'verboo')
        ) {
          return
        }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
    }))

    const { getDetectedLocalInstallDir, localInstallationExists } =
      await importFreshLocalInstaller()

    expect(await localInstallationExists()).toBe(true)
    expect(await getDetectedLocalInstallDir()).toBe(
      join(homedir(), '.verboo', 'local'),
    )
  })
})

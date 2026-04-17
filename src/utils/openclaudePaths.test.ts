import { afterEach, describe, expect, mock, test } from 'bun:test'
import * as fsPromises from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

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

afterEach(() => {
  process.env = { ...originalEnv }
  process.argv = [...originalArgv]
  mock.restore()
})

describe('Neural Network paths', () => {
  test('defaults user config home to ~/.openclaude', async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const { resolveClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(
      resolveClaudeConfigHomeDir({
        homeDir: homedir(),
        openClaudeExists: true,
        legacyClaudeExists: false,
      }),
    ).toBe(join(homedir(), '.openclaude'))
  })

  test('falls back to ~/.nnc when legacy config exists and ~/.openclaude does not', async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const { resolveClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(
      resolveClaudeConfigHomeDir({
        homeDir: homedir(),
        openClaudeExists: false,
        legacyClaudeExists: true,
      }),
    ).toBe(join(homedir(), '.nnc'))
  })

  test('uses CLAUDE_CONFIG_DIR override when provided', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/custom-openclaude'
    const { getClaudeConfigHomeDir, resolveClaudeConfigHomeDir } =
      await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/custom-openclaude')
    expect(
      resolveClaudeConfigHomeDir({
        configDirEnv: '/tmp/custom-openclaude',
      }),
    ).toBe('/tmp/custom-openclaude')
  })

  test('project and local settings paths use .nnc', async () => {
    const { getRelativeSettingsFilePathForSource } = await importFreshSettings()

    expect(getRelativeSettingsFilePathForSource('projectSettings')).toBe(
      '.nnc/settings.json',
    )
    expect(getRelativeSettingsFilePathForSource('localSettings')).toBe(
      '.nnc/settings.local.json',
    )
  })

  test('local installer uses openclaude wrapper path', async () => {
    // Force .openclaude config home so the test doesn't fall back to
    // ~/.nnc when ~/.openclaude doesn't exist on this machine.
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.openclaude')
    const { getLocalClaudePath } = await importFreshLocalInstaller()

    expect(getLocalClaudePath()).toBe(
      join(homedir(), '.openclaude', 'local', 'openclaude'),
    )
  })

  test('local installation detection matches .openclaude path', async () => {
    const { isManagedLocalInstallationPath } =
      await importFreshLocalInstaller()

    expect(
      isManagedLocalInstallationPath(
        `${join(homedir(), '.openclaude', 'local')}/node_modules/.bin/openclaude`,
      ),
    ).toBe(true)
  })

  test('local installation detection still matches legacy .claude path', async () => {
    const { isManagedLocalInstallationPath } =
      await importFreshLocalInstaller()

    expect(
      isManagedLocalInstallationPath(
        `${join(homedir(), '.nnc', 'local')}/node_modules/.bin/openclaude`,
      ),
    ).toBe(true)
  })

  test('candidate local install dirs include both openclaude and legacy claude paths', async () => {
    const { getCandidateLocalInstallDirs } = await importFreshLocalInstaller()

    expect(
      getCandidateLocalInstallDirs({
        configHomeDir: join(homedir(), '.openclaude'),
        homeDir: homedir(),
      }),
    ).toEqual([
      join(homedir(), '.openclaude', 'local'),
      join(homedir(), '.nnc', 'local'),
    ])
  })

  test('legacy local installs are detected when they still expose the claude binary', async () => {
    mock.module('fs/promises', () => ({
      ...fsPromises,
      access: async (path: string) => {
        if (
          path === join(homedir(), '.nnc', 'local', 'node_modules', '.bin', 'claude')
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
      join(homedir(), '.nnc', 'local'),
    )
  })
})

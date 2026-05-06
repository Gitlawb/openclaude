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

describe('OpenClaude paths', () => {
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

  test('falls back to ~/.claude when legacy config exists and ~/.openclaude does not', async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const { resolveClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(
      resolveClaudeConfigHomeDir({
        homeDir: homedir(),
        openClaudeExists: false,
        legacyClaudeExists: true,
      }),
    ).toBe(join(homedir(), '.claude'))
  })

  test('uses CLAUDE_CONFIG_DIR override when provided (legacy)', async () => {
    delete process.env.OPENCLAUDE_CONFIG_DIR
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

  test('OPENCLAUDE_CONFIG_DIR overrides the default (issue #454)', async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    process.env.OPENCLAUDE_CONFIG_DIR = '/tmp/oc-config-only'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/oc-config-only')
  })

  test('OPENCLAUDE_CONFIG_DIR wins when both env vars are set with different values', async () => {
    process.env.OPENCLAUDE_CONFIG_DIR = '/tmp/oc-wins'
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-loses'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/oc-wins')
  })

  test('CLAUDE_CONFIG_DIR is still honored when OPENCLAUDE_CONFIG_DIR is unset', async () => {
    delete process.env.OPENCLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-only'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/legacy-only')
  })

  test('empty OPENCLAUDE_CONFIG_DIR falls through to CLAUDE_CONFIG_DIR', async () => {
    process.env.OPENCLAUDE_CONFIG_DIR = ''
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-fallback'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/legacy-fallback')
  })

  test('resolveConfigDirEnv prefers OPENCLAUDE over CLAUDE and warns on conflict', async () => {
    const { resolveConfigDirEnv, __resetConfigDirEnvWarningForTesting } =
      await importFreshEnvUtils()
    __resetConfigDirEnvWarningForTesting()

    const warnings: string[] = []
    const result = resolveConfigDirEnv({
      openClaudeConfigDir: '/a',
      legacyConfigDir: '/b',
      warn: m => warnings.push(m),
    })

    expect(result).toBe('/a')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('OPENCLAUDE_CONFIG_DIR=/a')
    expect(warnings[0]).toContain('CLAUDE_CONFIG_DIR=/b')
  })

  test('resolveConfigDirEnv does not warn when both env vars agree', async () => {
    const { resolveConfigDirEnv, __resetConfigDirEnvWarningForTesting } =
      await importFreshEnvUtils()
    __resetConfigDirEnvWarningForTesting()

    const warnings: string[] = []
    const result = resolveConfigDirEnv({
      openClaudeConfigDir: '/same',
      legacyConfigDir: '/same',
      warn: m => warnings.push(m),
    })

    expect(result).toBe('/same')
    expect(warnings).toEqual([])
  })

  test('resolveConfigDirEnv returns undefined when neither env var is set', async () => {
    const { resolveConfigDirEnv } = await importFreshEnvUtils()

    expect(
      resolveConfigDirEnv({
        openClaudeConfigDir: undefined,
        legacyConfigDir: undefined,
      }),
    ).toBeUndefined()
  })

  test('project and local settings paths use .openclaude', async () => {
    const { getRelativeSettingsFilePathForSource } = await importFreshSettings()

    expect(getRelativeSettingsFilePathForSource('projectSettings')).toBe(
      '.openclaude/settings.json',
    )
    expect(getRelativeSettingsFilePathForSource('localSettings')).toBe(
      '.openclaude/settings.local.json',
    )
  })

  test('local installer uses openclaude wrapper path', async () => {
    // Force .openclaude config home so the test doesn't fall back to
    // ~/.claude when ~/.openclaude doesn't exist on this machine.
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
        `${join(homedir(), '.claude', 'local')}/node_modules/.bin/openclaude`,
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
      join(homedir(), '.claude', 'local'),
    ])
  })

  test('legacy local installs are detected when they still expose the claude binary', async () => {
    mock.module('fs/promises', () => ({
      ...fsPromises,
      access: async (path: string) => {
        if (
          path === join(homedir(), '.claude', 'local', 'node_modules', '.bin', 'claude')
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
      join(homedir(), '.claude', 'local'),
    )
  })
})

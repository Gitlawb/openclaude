import { afterEach, describe, expect, mock, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'

const originalEnv = { ...process.env }
const originalArgv = [...process.argv]

async function importFreshEnvUtils() {
  mock.restore()
  return import(`./envUtils.ts?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshSettings() {
  mock.restore()
  return import(`./settings/settings.ts?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshLocalInstaller() {
  mock.restore()
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
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe(join(homedir(), '.openclaude'))
  })

  test('uses CLAUDE_CONFIG_DIR override when provided', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/custom-openclaude'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/custom-openclaude')
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
    delete process.env.CLAUDE_CONFIG_DIR
    const { getLocalClaudePath } = await importFreshLocalInstaller()

    expect(getLocalClaudePath()).toBe(
      join(homedir(), '.openclaude', 'local', 'openclaude'),
    )
  })

  test('local installation detection matches .openclaude path', async () => {
    process.argv[1] =
      `${join(homedir(), '.openclaude', 'local')}/node_modules/.bin/openclaude`
    const { isRunningFromLocalInstallation } =
      await importFreshLocalInstaller()

    expect(isRunningFromLocalInstallation()).toBe(true)
  })
})

import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import * as fsPromises from 'fs/promises'
import { homedir, tmpdir } from 'os'
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

describe('OpenClaude paths', () => {
  test('defaults user config home to ~/.openclaude', async () => {
    await acquireEnvMutex()
    delete process.env.OPENCLAUDE_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    const { resolveClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(
      resolveClaudeConfigHomeDir({
        homeDir: homedir(),
      }),
    ).toBe(join(homedir(), '.openclaude'))
  })

  test('hard-cuts user config home to ~/.openclaude by default', async () => {
    await acquireEnvMutex()
    delete process.env.OPENCLAUDE_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    const { resolveClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(
      resolveClaudeConfigHomeDir({
        homeDir: homedir(),
      }),
    ).toBe(join(homedir(), '.openclaude'))
  })

  test('migrates legacy config home and global config files to .openclaude', async () => {
    await acquireEnvMutex()
    const tempHome = mkdtempSync(join(tmpdir(), 'openclaude-paths-test-'))
    try {
      mkdirSync(join(tempHome, '.claude', 'skills', 'legacy-skill'), {
        recursive: true,
      })
      writeFileSync(
        join(tempHome, '.claude', 'skills', 'legacy-skill', 'SKILL.md'),
        'legacy skill',
      )
      writeFileSync(join(tempHome, '.claude', 'settings.json'), '{}')
      writeFileSync(join(tempHome, '.claude.json'), '{"legacy":true}')
      writeFileSync(
        join(tempHome, '.claude-custom-oauth.json'),
        '{"custom":true}',
      )

      const { migrateLegacyClaudeConfigHome } = await importFreshEnvUtils()

      expect(migrateLegacyClaudeConfigHome({ homeDir: tempHome })).toBe(true)
      expect(
        readFileSync(
          join(tempHome, '.openclaude', 'skills', 'legacy-skill', 'SKILL.md'),
          'utf8',
        ),
      ).toBe('legacy skill')
      expect(existsSync(join(tempHome, '.openclaude', 'settings.json'))).toBe(
        true,
      )
      expect(readFileSync(join(tempHome, '.openclaude.json'), 'utf8')).toBe(
        '{"legacy":true}',
      )
      expect(
        readFileSync(join(tempHome, '.openclaude-custom-oauth.json'), 'utf8'),
      ).toBe('{"custom":true}')
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('migration preserves existing .openclaude data while copying missing legacy data', async () => {
    await acquireEnvMutex()
    const tempHome = mkdtempSync(join(tmpdir(), 'openclaude-paths-test-'))
    try {
      mkdirSync(join(tempHome, '.claude', 'skills', 'legacy-skill'), {
        recursive: true,
      })
      mkdirSync(join(tempHome, '.openclaude', 'skills'), { recursive: true })
      writeFileSync(join(tempHome, '.claude', 'settings.json'), 'legacy')
      writeFileSync(join(tempHome, '.openclaude', 'settings.json'), 'current')
      writeFileSync(
        join(tempHome, '.claude', 'skills', 'legacy-skill', 'SKILL.md'),
        'legacy skill',
      )

      const { migrateLegacyClaudeConfigHome } = await importFreshEnvUtils()

      expect(migrateLegacyClaudeConfigHome({ homeDir: tempHome })).toBe(true)
      expect(
        readFileSync(join(tempHome, '.openclaude', 'settings.json'), 'utf8'),
      ).toBe('current')
      expect(
        readFileSync(
          join(tempHome, '.openclaude', 'skills', 'legacy-skill', 'SKILL.md'),
          'utf8',
        ),
      ).toBe('legacy skill')
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('migration skips explicit CLAUDE_CONFIG_DIR overrides', async () => {
    await acquireEnvMutex()
    const tempHome = mkdtempSync(join(tmpdir(), 'openclaude-paths-test-'))
    try {
      mkdirSync(join(tempHome, '.claude'), { recursive: true })
      writeFileSync(join(tempHome, '.claude', 'settings.json'), 'legacy')

      const { migrateLegacyClaudeConfigHome } = await importFreshEnvUtils()

      expect(
        migrateLegacyClaudeConfigHome({
          configDirEnv: join(tempHome, 'custom-config'),
          homeDir: tempHome,
        }),
      ).toBe(true)
      expect(existsSync(join(tempHome, '.openclaude'))).toBe(false)
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('migration fails closed when .openclaude collides with a non-directory', async () => {
    await acquireEnvMutex()
    const tempHome = mkdtempSync(join(tmpdir(), 'openclaude-paths-test-'))
    try {
      writeFileSync(join(tempHome, '.openclaude'), 'not a directory')
      mkdirSync(join(tempHome, '.claude'), { recursive: true })
      writeFileSync(join(tempHome, '.claude', 'settings.json'), 'legacy')

      const { migrateLegacyClaudeConfigHome } = await importFreshEnvUtils()

      expect(migrateLegacyClaudeConfigHome({ homeDir: tempHome })).toBe(false)
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('migration ignores non-directory legacy config homes', async () => {
    await acquireEnvMutex()
    const tempHome = mkdtempSync(join(tmpdir(), 'openclaude-paths-test-'))
    try {
      writeFileSync(join(tempHome, '.claude'), 'not a directory')

      const { migrateLegacyClaudeConfigHome } = await importFreshEnvUtils()

      expect(migrateLegacyClaudeConfigHome({ homeDir: tempHome })).toBe(true)
      expect(existsSync(join(tempHome, '.openclaude'))).toBe(false)
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('config home falls back to legacy when migration fails on a non-directory .openclaude collision', async () => {
    await acquireEnvMutex()
    const tempHome = mkdtempSync(join(tmpdir(), 'openclaude-paths-test-'))
    try {
      writeFileSync(join(tempHome, '.openclaude'), 'not a directory')
      mkdirSync(join(tempHome, '.claude'), { recursive: true })
      mock.module('os', () => ({
        homedir: () => tempHome,
        tmpdir,
      }))
      delete process.env.OPENCLAUDE_CONFIG_DIR
      delete process.env.CLAUDE_CONFIG_DIR

      const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

      expect(getClaudeConfigHomeDir()).toBe(join(tempHome, '.claude'))
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('default plans directory uses ~/.openclaude/plans', async () => {
    await acquireEnvMutex()
    delete process.env.OPENCLAUDE_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    const { getDefaultPlansDirectory } = await importFreshPlans()

    expect(getDefaultPlansDirectory({ homeDir: homedir() })).toBe(
      join(homedir(), '.openclaude', 'plans'),
    )
  })

  test('default plans directory respects explicit CLAUDE_CONFIG_DIR', async () => {
    await acquireEnvMutex()
    const { getDefaultPlansDirectory } = await importFreshPlans()

    expect(
      getDefaultPlansDirectory({ configDirEnv: '/tmp/custom-openclaude' }),
    ).toBe(join('/tmp/custom-openclaude', 'plans'))
  })

  test('default plans directory respects OPENCLAUDE_CONFIG_DIR', async () => {
    await acquireEnvMutex()
    process.env.OPENCLAUDE_CONFIG_DIR = '/tmp/preferred-openclaude'
    delete process.env.CLAUDE_CONFIG_DIR
    const { getDefaultPlansDirectory } = await importFreshPlans()

    expect(getDefaultPlansDirectory()).toBe(
      join('/tmp/preferred-openclaude', 'plans'),
    )
  })

  test('OPENCLAUDE_CONFIG_DIR wins for default plans directory', async () => {
    await acquireEnvMutex()
    process.env.OPENCLAUDE_CONFIG_DIR = '/tmp/preferred-openclaude'
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-openclaude'
    const { getDefaultPlansDirectory } = await importFreshPlans()

    expect(getDefaultPlansDirectory()).toBe(
      join('/tmp/preferred-openclaude', 'plans'),
    )
  })

  test('default plans directory normalizes generated path to NFC', async () => {
    await acquireEnvMutex()
    const { getDefaultPlansDirectory } = await importFreshPlans()

    expect(
      getDefaultPlansDirectory({ homeDir: '/tmp/cafe\u0301' }),
    ).toBe(join('/tmp/caf\u00e9', '.openclaude', 'plans'))
  })

  test('default plans directory normalizes explicit CLAUDE_CONFIG_DIR to NFC', async () => {
    await acquireEnvMutex()
    const { getDefaultPlansDirectory } = await importFreshPlans()

    expect(
      getDefaultPlansDirectory({ configDirEnv: '/tmp/cafe\u0301-openclaude' }),
    ).toBe(join('/tmp/caf\u00e9-openclaude', 'plans'))
  })

  test('uses CLAUDE_CONFIG_DIR override when provided (legacy)', async () => {
    await acquireEnvMutex()
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
    await acquireEnvMutex()
    delete process.env.CLAUDE_CONFIG_DIR
    process.env.OPENCLAUDE_CONFIG_DIR = '/tmp/oc-config-only'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/oc-config-only')
  })

  test('OPENCLAUDE_CONFIG_DIR wins when both env vars are set with different values', async () => {
    await acquireEnvMutex()
    process.env.OPENCLAUDE_CONFIG_DIR = '/tmp/oc-wins'
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-loses'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/oc-wins')
  })

  test('CLAUDE_CONFIG_DIR is still honored when OPENCLAUDE_CONFIG_DIR is unset', async () => {
    await acquireEnvMutex()
    delete process.env.OPENCLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-only'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/legacy-only')
  })

  test('empty OPENCLAUDE_CONFIG_DIR falls through to CLAUDE_CONFIG_DIR', async () => {
    await acquireEnvMutex()
    process.env.OPENCLAUDE_CONFIG_DIR = ''
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-fallback'
    const { getClaudeConfigHomeDir } = await importFreshEnvUtils()

    expect(getClaudeConfigHomeDir()).toBe('/tmp/legacy-fallback')
  })

  test('resolveConfigDirEnv prefers OPENCLAUDE over CLAUDE and warns on conflict', async () => {
    await acquireEnvMutex()
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

    resolveConfigDirEnv({
      openClaudeConfigDir: '/x',
      legacyConfigDir: '/y',
      warn: m => warnings.push(m),
    })
    expect(warnings.length).toBe(1)
  })

  test('resolveConfigDirEnv silent callers do not consume the conflict warning', async () => {
    await acquireEnvMutex()
    const { resolveConfigDirEnv, __resetConfigDirEnvWarningForTesting } =
      await importFreshEnvUtils()
    __resetConfigDirEnvWarningForTesting()

    expect(
      resolveConfigDirEnv({
        openClaudeConfigDir: '/silent-open',
        legacyConfigDir: '/silent-legacy',
      }),
    ).toBe('/silent-open')

    const warnings: string[] = []
    expect(
      resolveConfigDirEnv({
        openClaudeConfigDir: '/warn-open',
        legacyConfigDir: '/warn-legacy',
        warn: m => warnings.push(m),
      }),
    ).toBe('/warn-open')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('OPENCLAUDE_CONFIG_DIR=/warn-open')
    expect(warnings[0]).toContain('CLAUDE_CONFIG_DIR=/warn-legacy')
  })

  test('resolveConfigDirEnv does not warn when both env vars agree', async () => {
    await acquireEnvMutex()
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
    await acquireEnvMutex()
    const { resolveConfigDirEnv } = await importFreshEnvUtils()

    expect(
      resolveConfigDirEnv({
        openClaudeConfigDir: undefined,
        legacyConfigDir: undefined,
      }),
    ).toBeUndefined()
  })

  test('project and local settings paths use .openclaude', async () => {
    await acquireEnvMutex()
    const { getRelativeSettingsFilePathForSource } = await importFreshSettings()

    expect(getRelativeSettingsFilePathForSource('projectSettings')).toBe(
      '.openclaude/settings.json',
    )
    expect(getRelativeSettingsFilePathForSource('localSettings')).toBe(
      '.openclaude/settings.local.json',
    )
  })

  test('local installer uses openclaude wrapper path', async () => {
    await acquireEnvMutex()
    // Force .openclaude config home so the test doesn't fall back to
    // ~/.claude when ~/.openclaude doesn't exist on this machine.
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.openclaude')
    const { getLocalClaudePath } = await importFreshLocalInstaller()

    expect(getLocalClaudePath()).toBe(
      join(homedir(), '.openclaude', 'local', 'openclaude'),
    )
  })

  test('local installation detection matches .openclaude path', async () => {
    await acquireEnvMutex()
    const { isManagedLocalInstallationPath } =
      await importFreshLocalInstaller()

    expect(
      isManagedLocalInstallationPath(
        `${join(homedir(), '.openclaude', 'local')}/node_modules/.bin/openclaude`,
      ),
    ).toBe(true)
  })

  test('local installation detection still matches legacy .claude path', async () => {
    await acquireEnvMutex()
    const { isManagedLocalInstallationPath } =
      await importFreshLocalInstaller()

    expect(
      isManagedLocalInstallationPath(
        `${join(homedir(), '.claude', 'local')}/node_modules/.bin/openclaude`,
      ),
    ).toBe(true)
  })

  test('candidate local install dirs include both openclaude and legacy claude paths', async () => {
    await acquireEnvMutex()
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
    await acquireEnvMutex()
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

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { settingsWriteResult } from '../../test/settingsWriteResult.js'
import {
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../envUtils.js'
import {
  getSettingsForSource,
} from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { installResolvedPlugin } from './pluginInstallationHelpers.js'
import { loadInstalledPluginsFromDisk } from './installedPluginsManager.js'

let tempRoot: string | undefined
let originalConfigOverride: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock(
    'utils/plugins/pluginInstallationHelpers.transaction.test.ts',
  )
  tempRoot = mkdtempSync(join(tmpdir(), 'plugin-install-transaction-'))
  originalConfigOverride = getClaudeConfigHomeDirOverrideForTesting()
  setClaudeConfigHomeDirForTesting(join(tempRoot, 'config'))
  resetSettingsCache()
})

afterEach(() => {
  try {
    resetSettingsCache()
    setClaudeConfigHomeDirForTesting(originalConfigOverride)
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  } finally {
    releaseSharedMutationLock()
  }
})

test('invalid local sources are rejected before enabledPlugins is committed', async () => {
  const marketplaceRoot = join(tempRoot!, 'marketplace')
  mkdirSync(marketplaceRoot, { recursive: true })

  await expect(
    installResolvedPlugin({
      pluginId: 'demo@community',
      entry: {
        name: 'demo',
        source: './../../outside',
        strict: false,
      },
      scope: 'user',
      marketplaceInstallLocation: marketplaceRoot,
    }),
  ).rejects.toThrow('Path traversal detected')

  resetSettingsCache()
  expect(
    getSettingsForSource('userSettings')?.enabledPlugins?.['demo@community'],
  ).toBeUndefined()
})

test('materialization failures leave the plugin disabled and unregistered', async () => {
  const marketplaceRoot = join(tempRoot!, 'marketplace')
  const pluginRoot = join(marketplaceRoot, 'plugins', 'demo')
  mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(pluginRoot, '.claude-plugin', 'plugin.json'),
    '{ invalid json',
    'utf8',
  )

  await expect(
    installResolvedPlugin({
      pluginId: 'demo@community',
      entry: {
        name: 'demo',
        source: './plugins/demo',
        strict: false,
      },
      scope: 'user',
      marketplaceInstallLocation: marketplaceRoot,
    }),
  ).rejects.toThrow('corrupt manifest')

  resetSettingsCache()
  expect(
    getSettingsForSource('userSettings')?.enabledPlugins?.['demo@community'],
  ).toBeUndefined()
  expect(
    loadInstalledPluginsFromDisk().plugins['demo@community'],
  ).toBeUndefined()
})

test.each([
  {
    label: 'skipped',
    compareAndSwap: () => false,
    expectedMessage: 'was skipped',
  },
  {
    label: 'failed',
    compareAndSwap: () => {
      throw new Error('installed registry is locked')
    },
    expectedMessage: 'failed',
  },
])(
  'a $label registration rollback is reported without replacing a rejected settings result',
  async ({ compareAndSwap, expectedMessage }) => {
    const marketplaceRoot = join(tempRoot!, 'marketplace')
    const pluginRoot = join(marketplaceRoot, 'plugins', 'demo')
    mkdirSync(pluginRoot, { recursive: true })
    const current = {
      scope: 'user' as const,
      installPath: join(tempRoot!, 'cache', 'demo'),
      version: '1.0.0',
      installedAt: '2026-08-16T00:00:00.000Z',
      lastUpdated: '2026-08-16T00:00:00.000Z',
    }
    const reportError = mock((_error: unknown) => {})

    const result = await installResolvedPlugin({
      pluginId: 'demo@community',
      entry: {
        name: 'demo',
        source: './plugins/demo',
        strict: false,
      },
      scope: 'user',
      marketplaceInstallLocation: marketplaceRoot,
      dependencies: {
        cacheAndRegisterPlugin: mock(async () => ({
          installPath: current.installPath,
          registration: { previous: undefined, current },
        })),
        updateFresh: () =>
          settingsWriteResult({
            error: new Error('settings file is locked'),
            written: false,
          }),
        compareAndSwap,
        reportError,
      },
    })

    expect(result).toEqual({
      ok: false,
      reason: 'settings-write-failed',
      message: 'settings file is locked',
    })
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(String(reportError.mock.calls[0]?.[0])).toContain(expectedMessage)
  },
)

import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as installedPluginsManager from '../utils/plugins/installedPluginsManager.js'
import * as pluginInstallationHelpers from '../utils/plugins/pluginInstallationHelpers.js'
import * as settingsModule from '../utils/settings/settings.js'

let defaultMarketplaceRoot: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock(
    'hooks/useLspPluginRecommendation.transaction.test.ts',
  )
  defaultMarketplaceRoot = mkdtempSync(join(tmpdir(), 'lsp-marketplace-'))
  mkdirSync(join(defaultMarketplaceRoot, 'plugins', 'demo'), {
    recursive: true,
  })
})

afterEach(() => {
  try {
    mock.restore()
    if (defaultMarketplaceRoot) {
      rmSync(defaultMarketplaceRoot, { recursive: true, force: true })
    }
    defaultMarketplaceRoot = undefined
  } finally {
    releaseSharedMutationLock()
  }
})

test('rejects a local recommendation source outside its marketplace root', async () => {
  const cacheAndRegister = spyOn(
    pluginInstallationHelpers,
    'cacheAndRegisterPlugin',
  )
  const { installRecommendedLspPlugin } = await import(
    `./useLspPluginRecommendation.js?path-traversal=${Date.now()}`
  )

  await expect(
    installRecommendedLspPlugin('demo@community', {
      entry: {
        name: 'demo',
        source: '../outside/demo',
        version: '1.0.0',
      } as never,
      marketplaceInstallLocation: defaultMarketplaceRoot!,
    }),
  ).rejects.toThrow('outside')
  expect(cacheAndRegister).not.toHaveBeenCalled()
})

test('rejects a local recommendation source symlinked outside its marketplace root', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'lsp-plugin-source-'))
  const marketplaceRoot = join(tempRoot, 'marketplace')
  const outsideRoot = join(tempRoot, 'outside')
  mkdirSync(join(marketplaceRoot, 'plugins'), { recursive: true })
  mkdirSync(outsideRoot)
  symlinkSync(outsideRoot, join(marketplaceRoot, 'plugins', 'link'))
  const cacheAndRegister = spyOn(
    pluginInstallationHelpers,
    'cacheAndRegisterPlugin',
  )

  try {
    const { installRecommendedLspPlugin } = await import(
      `./useLspPluginRecommendation.js?symlink-escape=${Date.now()}`
    )
    await expect(
      installRecommendedLspPlugin('demo@community', {
        entry: {
          name: 'demo',
          source: './plugins/link',
          version: '1.0.0',
        } as never,
        marketplaceInstallLocation: marketplaceRoot,
      }),
    ).rejects.toThrow('escape')
    expect(cacheAndRegister).not.toHaveBeenCalled()
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('rejected enable persistence removes the recommendation registration', async () => {
  spyOn(pluginInstallationHelpers, 'cacheAndRegisterPlugin').mockResolvedValue(
    {
      installPath: '/tmp/demo-cache',
      registration: {
        previous: undefined,
        current: {
          scope: 'user',
          installPath: '/tmp/demo-cache',
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  )
  const compareAndSwap = spyOn(
    installedPluginsManager,
    'compareAndSwapPluginInstallation',
  ).mockReturnValue(true)
  spyOn(
    settingsModule,
    'updateSettingsForSourceWithFreshSettings',
  ).mockReturnValue({
    error: new Error('settings file is locked'),
    written: false,
  })

  const { installRecommendedLspPlugin } = await import(
    `./useLspPluginRecommendation.js?rejected=${Date.now()}`
  )

  await expect(
    installRecommendedLspPlugin('demo@community', {
      entry: {
        name: 'demo',
        source: './plugins/demo',
        version: '1.0.0',
      } as never,
      marketplaceInstallLocation: defaultMarketplaceRoot!,
    }),
  ).rejects.toThrow('settings file is locked')
  expect(compareAndSwap).toHaveBeenCalledWith(
    'demo@community',
    'user',
    undefined,
    {
      scope: 'user',
      installPath: '/tmp/demo-cache',
      version: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
    },
    undefined,
  )
})

test('rejected enable persistence restores a pre-existing user registration', async () => {
  const previousInstallation = {
    scope: 'user' as const,
    installPath: '/tmp/demo-cache-v1',
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
  }
  const registeredInstallation = {
    ...previousInstallation,
    installPath: '/tmp/demo-cache-v2',
    version: '2.0.0',
    lastUpdated: '2026-02-01T00:00:00.000Z',
  }
  spyOn(pluginInstallationHelpers, 'cacheAndRegisterPlugin').mockResolvedValue(
    {
      installPath: registeredInstallation.installPath,
      registration: {
        previous: previousInstallation,
        current: registeredInstallation,
      },
    },
  )
  const compareAndSwap = spyOn(
    installedPluginsManager,
    'compareAndSwapPluginInstallation',
  ).mockReturnValue(true)
  spyOn(
    settingsModule,
    'updateSettingsForSourceWithFreshSettings',
  ).mockReturnValue({
    error: new Error('settings file is locked'),
    written: false,
  })

  const { installRecommendedLspPlugin } = await import(
    `./useLspPluginRecommendation.js?restore=${Date.now()}`
  )

  await expect(
    installRecommendedLspPlugin('demo@community', {
      entry: {
        name: 'demo',
        source: './plugins/demo',
        version: '2.0.0',
      } as never,
      marketplaceInstallLocation: defaultMarketplaceRoot!,
    }),
  ).rejects.toThrow('settings file is locked')
  expect(compareAndSwap).toHaveBeenCalledWith(
    'demo@community',
    'user',
    undefined,
    registeredInstallation,
    previousInstallation,
  )
})

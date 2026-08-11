import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { installSelectedPlugins } from './pluginStartupCheck.js'

beforeEach(async () => {
  await acquireSharedMutationLock(
    'utils/plugins/pluginStartupCheck.transaction.test.ts',
  )
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('a rejected enabledPlugins write rolls back the installation registration', async () => {
  const registeredEntry = {
    scope: 'user' as const,
    installPath: '/tmp/test-marketplace/plugins/demo',
    version: '1.0.0',
    installedAt: '2026-08-11T00:00:00.000Z',
    lastUpdated: '2026-08-11T00:00:00.000Z',
  }
  const getPluginById = mock(async () => ({
    entry: {
      name: 'demo',
      source: './plugins/demo',
      version: '1.0.0',
    },
    marketplaceInstallLocation: '/tmp/test-marketplace',
  }))
  const registerPluginInstallation = mock(() => ({
    previous: undefined,
    current: registeredEntry,
  }))
  const compareAndSwap = mock(() => true)
  const updateSettingsForSource = mock(() => ({
    error: new Error('settings file is locked'),
    written: false,
  }))

  const result = await installSelectedPlugins(
    ['demo@community'],
    undefined,
    'user',
    {
      getPluginById: getPluginById as never,
      cacheAndRegisterPlugin: mock(async () => {
        throw new Error('external cache path should not run')
      }) as never,
      registerPluginInstallation,
      validatePathWithinBase: () => registeredEntry.installPath,
      updateSettingsForSource: updateSettingsForSource as never,
      compareAndSwapPluginInstallation: compareAndSwap,
    },
  )

  expect(registerPluginInstallation).toHaveBeenCalled()
  expect(compareAndSwap).toHaveBeenCalledWith(
    'demo@community',
    'user',
    undefined,
    registeredEntry,
    undefined,
  )
  expect(result).toEqual({
    installed: [],
    failed: [
      { name: 'demo@community', error: 'settings file is locked' },
    ],
  })
})

test('a rejected settings write restores a preexisting installation instead of deleting it', async () => {
  const previousEntry = {
    scope: 'user' as const,
    installPath: '/tmp/original-demo',
    version: '0.9.0',
    installedAt: '2026-08-10T00:00:00.000Z',
    lastUpdated: '2026-08-10T00:00:00.000Z',
  }
  const registeredEntry = {
    ...previousEntry,
    installPath: '/tmp/test-marketplace/plugins/demo',
    version: '1.0.0',
    lastUpdated: '2026-08-11T00:00:00.000Z',
  }
  const getPluginById = mock(async () => ({
    entry: {
      name: 'demo',
      source: './plugins/demo',
      version: '1.0.0',
    },
    marketplaceInstallLocation: '/tmp/test-marketplace',
  }))
  const registerPluginInstallation = mock(() => ({
    previous: previousEntry,
    current: registeredEntry,
  }))
  const compareAndSwap = mock(() => true)
  const updateSettingsForSource = mock(() => ({
    error: new Error('settings file is locked'),
    written: false,
  }))

  const result = await installSelectedPlugins(
    ['demo@community'],
    undefined,
    'user',
    {
      getPluginById: getPluginById as never,
      cacheAndRegisterPlugin: mock(async () => {
        throw new Error('external cache path should not run')
      }) as never,
      registerPluginInstallation,
      validatePathWithinBase: () => registeredEntry.installPath,
      updateSettingsForSource: updateSettingsForSource as never,
      compareAndSwapPluginInstallation: compareAndSwap,
    },
  )

  expect(compareAndSwap).toHaveBeenCalledWith(
    'demo@community',
    'user',
    undefined,
    registeredEntry,
    previousEntry,
  )
  expect(result.installed).toEqual([])
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  addInstalledPlugin,
  addPluginInstallation,
  clearInstalledPluginsCache,
  compareAndSwapPluginInstallation,
  getInstalledPluginsFilePath,
  loadInstalledPluginsV2,
  removeInstalledPlugin,
  removeAllPluginsForMarketplace,
  removePluginInstallation,
  updateInstallationPathOnDisk,
} from './installedPluginsManager.js'

const originalPluginCacheDir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
let tempRoot: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock(
    'utils/plugins/installedPluginsManager.transaction.test.ts',
  )
  tempRoot = mkdtempSync(join(tmpdir(), 'openclaude-installed-plugins-'))
  process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = join(tempRoot, 'plugins')
  clearInstalledPluginsCache()
})

afterEach(() => {
  try {
    clearInstalledPluginsCache()
    if (originalPluginCacheDir === undefined) {
      delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
    } else {
      process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = originalPluginCacheDir
    }
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  } finally {
    releaseSharedMutationLock()
  }
})

test('failed last-scope cleanup keeps the installation registered for retry', () => {
  const pluginId = 'retryable@community'
  addPluginInstallation(pluginId, 'user', join(tempRoot!, 'v1'), {
    version: '1.0.0',
    installedAt: '2026-08-11T00:00:00.000Z',
  })

  expect(() =>
    removePluginInstallation(pluginId, 'user', undefined, {
      beforeLastRemoval() {
        throw new Error('secure cleanup unavailable')
      },
    }),
  ).toThrow('secure cleanup unavailable')

  clearInstalledPluginsCache()
  expect(loadInstalledPluginsV2().plugins[pluginId]).toHaveLength(1)

  expect(removePluginInstallation(pluginId, 'user')).toMatchObject({
    removed: true,
    removedLastScope: true,
  })
  clearInstalledPluginsCache()
  expect(loadInstalledPluginsV2().plugins[pluginId]).toBeUndefined()
})

test('failed marketplace cleanup keeps every installation registered for retry', () => {
  addPluginInstallation('one@community', 'user', join(tempRoot!, 'one'), {
    version: '1.0.0',
  })
  addPluginInstallation('two@community', 'project', join(tempRoot!, 'two'), {
    version: '2.0.0',
  }, tempRoot!)

  expect(() =>
    removeAllPluginsForMarketplace('community', {
      beforeRemove() {
        throw new Error('option cleanup unavailable')
      },
    }),
  ).toThrow('option cleanup unavailable')

  clearInstalledPluginsCache()
  expect(Object.keys(loadInstalledPluginsV2().plugins).sort()).toEqual([
    'one@community',
    'two@community',
  ])

  expect(removeAllPluginsForMarketplace('community').removedPluginIds.sort()).toEqual([
    'one@community',
    'two@community',
  ])
})

test('snapshot-scoped marketplace removal preserves a later registry entry', () => {
  addPluginInstallation('one@community', 'user', join(tempRoot!, 'one'), {
    version: '1.0.0',
  })
  addPluginInstallation('peer@community', 'user', join(tempRoot!, 'peer'), {
    version: '2.0.0',
  })

  expect(
    removeAllPluginsForMarketplace('community', {
      pluginIds: ['one@community'],
    }).removedPluginIds,
  ).toEqual(['one@community'])
  expect(loadInstalledPluginsV2().plugins['peer@community']).toHaveLength(1)
})

test('compare-and-swap preserves a concurrently replaced installation', () => {
  const pluginId = 'lsp@community'
  addPluginInstallation(pluginId, 'user', join(tempRoot!, 'v1'), {
    version: '1.0.0',
  })
  const original = structuredClone(loadInstalledPluginsV2().plugins[pluginId]![0]!)

  const registryPath = getInstalledPluginsFilePath()
  const peerState = JSON.parse(readFileSync(registryPath, 'utf8'))
  peerState.plugins[pluginId][0] = {
    ...peerState.plugins[pluginId][0],
    installPath: join(tempRoot!, 'v2'),
    version: '2.0.0',
  }
  writeFileSync(registryPath, JSON.stringify(peerState), 'utf8')

  expect(
    compareAndSwapPluginInstallation(
      pluginId,
      'user',
      undefined,
      original,
      undefined,
    ),
  ).toBe(false)
  // The failed CAS still completed a fresh lock-scoped read. That snapshot
  // must replace the older public disk cache without a manual invalidation.
  expect(loadInstalledPluginsV2().plugins[pluginId]![0]).toMatchObject({
    installPath: join(tempRoot!, 'v2'),
    version: '2.0.0',
  })
})

test('legacy registry writers preserve peer entries and return an exact mutation token', () => {
  const first = addInstalledPlugin('one@community', {
    version: '1.0.0',
    installedAt: '2026-08-11T00:00:00.000Z',
    lastUpdated: '2026-08-11T00:00:00.000Z',
    installPath: join(tempRoot!, 'one-v1'),
  })
  addInstalledPlugin('two@community', {
    version: '1.0.0',
    installedAt: '2026-08-11T00:00:00.000Z',
    lastUpdated: '2026-08-11T00:00:00.000Z',
    installPath: join(tempRoot!, 'two-v1'),
  })

  expect(first.previous).toBeUndefined()
  expect(first.current.installPath).toBe(join(tempRoot!, 'one-v1'))

  updateInstallationPathOnDisk(
    'one@community',
    'user',
    undefined,
    join(tempRoot!, 'one-v2'),
    '2.0.0',
  )
  removeInstalledPlugin('one@community')

  clearInstalledPluginsCache()
  expect(loadInstalledPluginsV2().plugins['one@community']).toBeUndefined()
  expect(loadInstalledPluginsV2().plugins['two@community']?.[0]).toMatchObject({
    installPath: join(tempRoot!, 'two-v1'),
    version: '1.0.0',
  })
})

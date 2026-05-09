import { describe, expect, test } from 'bun:test'

import type { LoadedPlugin } from '../../types/plugin.js'
import {
  mergePluginSources,
  resolvePluginComponentPath,
} from './pluginLoader.js'

function marketplacePlugin(
  name: string,
  marketplace: string,
  enabled: boolean,
): LoadedPlugin {
  const pluginId = `${name}@${marketplace}`
  return {
    name,
    manifest: { name } as LoadedPlugin['manifest'],
    path: `/tmp/${pluginId}`,
    source: pluginId,
    repository: pluginId,
    enabled,
  }
}

describe('mergePluginSources', () => {
  test('keeps the enabled copy when duplicate marketplace plugins disagree on enabled state', () => {
    const enabledOfficial = marketplacePlugin(
      'frontend-design',
      'claude-plugins-official',
      true,
    )
    const disabledLegacy = marketplacePlugin(
      'frontend-design',
      'claude-code-plugins',
      false,
    )

    const result = mergePluginSources({
      session: [],
      marketplace: [disabledLegacy, enabledOfficial],
      builtin: [],
    })

    expect(result.plugins).toEqual([enabledOfficial])
    expect(result.errors).toEqual([])
  })

  test('keeps the later copy when duplicate marketplace plugins are both enabled', () => {
    const legacy = marketplacePlugin(
      'frontend-design',
      'claude-code-plugins',
      true,
    )
    const official = marketplacePlugin(
      'frontend-design',
      'claude-plugins-official',
      true,
    )

    const result = mergePluginSources({
      session: [],
      marketplace: [legacy, official],
      builtin: [],
    })

    expect(result.plugins).toEqual([official])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      type: 'generic-error',
      source: legacy.source,
      plugin: legacy.name,
    })
  })
})

describe('resolvePluginComponentPath', () => {
  test('keeps relative component paths inside the plugin directory', () => {
    expect(resolvePluginComponentPath('/tmp/plugin', 'commands/build.md')).toBe(
      '/tmp/plugin/commands/build.md',
    )
  })

  test('rejects component paths that traverse outside the plugin directory', () => {
    expect(resolvePluginComponentPath('/tmp/plugin', '../secret.md')).toBeNull()
    expect(
      resolvePluginComponentPath('/tmp/plugin', 'commands/../../secret.md'),
    ).toBeNull()
  })

  test('rejects absolute component paths outside the plugin directory', () => {
    expect(resolvePluginComponentPath('/tmp/plugin', '/etc/passwd')).toBeNull()
  })
})

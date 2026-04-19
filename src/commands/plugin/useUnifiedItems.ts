import { useMemo } from 'react'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { PluginError } from '../../types/plugin.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { getFlaggedPlugins, type FlaggedPlugin } from '../../utils/plugins/pluginFlagging.js'
import { getPluginEditableScopes } from '../../utils/plugins/pluginStartupCheck.js'
import { type PersistablePluginScope, parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import type { UnifiedInstalledItem } from './unifiedTypes.js'

type PluginState = {
  plugin: LoadedPlugin
  marketplace: string
  scope?: 'user' | 'project' | 'local' | 'managed' | 'builtin'
  pendingEnable?: boolean
  pendingUpdate?: boolean
}

type UseUnifiedItemsInput = {
  pluginStates: PluginState[]
  mcpClients: MCPServerConnection[]
  pluginErrors: PluginError[]
  pendingToggles: Map<string, 'will-enable' | 'will-disable'>
}

function getMcpStatus(client: MCPServerConnection): 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed' {
  if (client.type === 'connected') return 'connected'
  if (client.type === 'disabled') return 'disabled'
  if (client.type === 'pending') return 'pending'
  if (client.type === 'needs-auth') return 'needs-auth'
  return 'failed'
}

export function useUnifiedItems({
  pluginStates,
  mcpClients,
  pluginErrors,
  pendingToggles,
}: UseUnifiedItemsInput): UnifiedInstalledItem[] {
  const flaggedPlugins = getFlaggedPlugins()

  return useMemo(() => {
    const mergedSettings = getSettings_DEPRECATED()

    // Build map of plugin name -> child MCPs
    const pluginMcpMap = new Map<string, Array<{
      displayName: string
      client: MCPServerConnection
    }>>()
    for (const client of mcpClients) {
      if (client.name.startsWith('plugin:')) {
        const parts = client.name.split(':')
        if (parts.length >= 3) {
          const pluginName = parts[1]!
          const serverName = parts.slice(2).join(':')
          const existing = pluginMcpMap.get(pluginName) || []
          existing.push({ displayName: serverName, client })
          pluginMcpMap.set(pluginName, existing)
        }
      }
    }

    // Build plugin items
    type PluginWithChildren = {
      item: UnifiedInstalledItem & { type: 'plugin' }
      originalScope: 'user' | 'project' | 'local' | 'managed' | 'builtin'
      childMcps: Array<{ displayName: string; client: MCPServerConnection }>
    }
    const pluginsWithChildren: PluginWithChildren[] = []
    for (const state of pluginStates) {
      const pluginId = `${state.plugin.name}@${state.marketplace}`
      const isEnabled = mergedSettings?.enabledPlugins?.[pluginId] !== false
      const errors = pluginErrors.filter(
        e => 'plugin' in e && e.plugin === state.plugin.name || e.source === pluginId || e.source.startsWith(`${state.plugin.name}@`),
      )

      const originalScope = state.plugin.isBuiltin ? 'builtin' : state.scope || 'user'
      pluginsWithChildren.push({
        item: {
          type: 'plugin',
          id: pluginId,
          name: state.plugin.name,
          description: state.plugin.manifest.description,
          marketplace: state.marketplace,
          scope: originalScope,
          isEnabled,
          errorCount: errors.length,
          errors,
          plugin: state.plugin,
          pendingEnable: state.pendingEnable,
          pendingUpdate: state.pendingUpdate,
          pendingToggle: pendingToggles.get(pluginId),
        },
        originalScope,
        childMcps: pluginMcpMap.get(state.plugin.name) || [],
      })
    }

    // Find orphan errors
    const matchedPluginIds = new Set(pluginsWithChildren.map(({ item }) => item.id))
    const matchedPluginNames = new Set(pluginsWithChildren.map(({ item }) => item.name))
    const orphanErrorsBySource = new Map<string, typeof pluginErrors>()
    for (const error of pluginErrors) {
      if (matchedPluginIds.has(error.source) || ('plugin' in error && typeof error.plugin === 'string' && matchedPluginNames.has(error.plugin))) {
        continue
      }
      const existing = orphanErrorsBySource.get(error.source) || []
      existing.push(error)
      orphanErrorsBySource.set(error.source, existing)
    }

    const pluginScopes = getPluginEditableScopes()
    const failedPluginItems: UnifiedInstalledItem[] = []
    for (const [pluginId, errors] of orphanErrorsBySource) {
      if (pluginId in flaggedPlugins) continue
      const parsed = parsePluginIdentifier(pluginId)
      const pluginName = parsed.name || pluginId
      const marketplace = parsed.marketplace || 'unknown'
      const rawScope = pluginScopes.get(pluginId)
      const scope: PersistablePluginScope = rawScope === 'flag' || rawScope === undefined ? 'user' : rawScope
      failedPluginItems.push({
        type: 'failed-plugin',
        id: pluginId,
        name: pluginName,
        marketplace,
        scope,
        errorCount: errors.length,
        errors,
      })
    }

    // Build standalone MCP items
    const standaloneMcps: UnifiedInstalledItem[] = []
    for (const client of mcpClients) {
      if (client.name === 'ide') continue
      if (client.name.startsWith('plugin:')) continue
      standaloneMcps.push({
        type: 'mcp',
        id: `mcp:${client.name}`,
        name: client.name,
        description: undefined,
        scope: client.config.scope,
        status: getMcpStatus(client),
        client,
      })
    }

    // Define scope order for display
    const scopeOrder: Record<string, number> = {
      flagged: -1,
      project: 0,
      local: 1,
      user: 2,
      enterprise: 3,
      managed: 4,
      dynamic: 5,
      builtin: 6,
    }

    // Build final list by merging plugins (with child MCPs) and standalone MCPs
    const unified: UnifiedInstalledItem[] = []
    const itemsByScope = new Map<string, UnifiedInstalledItem[]>()

    // Add plugins with their child MCPs
    for (const { item, originalScope, childMcps } of pluginsWithChildren) {
      if (!itemsByScope.has(item.scope)) {
        itemsByScope.set(item.scope, [])
      }
      itemsByScope.get(item.scope)!.push(item)
      for (const { displayName, client } of childMcps) {
        const displayScope = originalScope === 'builtin' ? 'user' : originalScope
        if (!itemsByScope.has(displayScope)) {
          itemsByScope.set(displayScope, [])
        }
        itemsByScope.get(displayScope)!.push({
          type: 'mcp',
          id: `mcp:${client.name}`,
          name: displayName,
          description: undefined,
          scope: displayScope,
          status: getMcpStatus(client),
          client,
          indented: true,
        })
      }
    }

    // Add standalone MCPs
    for (const mcp of standaloneMcps) {
      if (!itemsByScope.has(mcp.scope)) {
        itemsByScope.set(mcp.scope, [])
      }
      itemsByScope.get(mcp.scope)!.push(mcp)
    }

    // Add failed plugins
    for (const failedPlugin of failedPluginItems) {
      if (!itemsByScope.has(failedPlugin.scope)) {
        itemsByScope.set(failedPlugin.scope, [])
      }
      itemsByScope.get(failedPlugin.scope)!.push(failedPlugin)
    }

    // Add flagged plugins
    for (const [pluginId, entry] of Object.entries(flaggedPlugins)) {
      const parsed = parsePluginIdentifier(pluginId)
      const pluginName = parsed.name || pluginId
      const marketplace = parsed.marketplace || 'unknown'
      if (!itemsByScope.has('flagged')) {
        itemsByScope.set('flagged', [])
      }
      itemsByScope.get('flagged')!.push({
        type: 'flagged-plugin',
        id: pluginId,
        name: pluginName,
        marketplace,
        scope: 'flagged',
        reason: 'delisted',
        text: 'Removed from marketplace',
        flaggedAt: entry.flaggedAt,
      })
    }

    // Sort scopes and build final list
    const sortedScopes = [...itemsByScope.keys()].sort(
      (a, b) => (scopeOrder[a] ?? 99) - (scopeOrder[b] ?? 99),
    )
    for (const scope of sortedScopes) {
      const items = itemsByScope.get(scope)!

      // Separate items into plugin groups and standalone MCPs
      const pluginGroups: UnifiedInstalledItem[][] = []
      const standaloneMcpsInScope: UnifiedInstalledItem[] = []
      let i = 0
      while (i < items.length) {
        const item = items[i]!
        if (item.type === 'plugin' || item.type === 'failed-plugin' || item.type === 'flagged-plugin') {
          const group: UnifiedInstalledItem[] = [item]
          i++
          let nextItem = items[i]
          while (nextItem?.type === 'mcp' && nextItem.indented) {
            group.push(nextItem)
            i++
            nextItem = items[i]
          }
          pluginGroups.push(group)
        } else if (item.type === 'mcp' && !item.indented) {
          standaloneMcpsInScope.push(item)
          i++
        } else {
          i++
        }
      }

      pluginGroups.sort((a, b) => a[0]!.name.localeCompare(b[0]!.name))
      standaloneMcpsInScope.sort((a, b) => a.name.localeCompare(b.name))

      for (const group of pluginGroups) {
        unified.push(...group)
      }
      unified.push(...standaloneMcpsInScope)
    }

    return unified
  }, [pluginStates, mcpClients, pluginErrors, pendingToggles, flaggedPlugins])
}
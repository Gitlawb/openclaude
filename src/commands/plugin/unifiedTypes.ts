import type { MCPServerConnection, ConfigScope } from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import type { PersistablePluginScope } from '../../utils/plugins/pluginIdentifier.js'

export type UnifiedInstalledScope = ConfigScope | PersistablePluginScope | 'builtin' | 'flagged'

export type PluginListItem = {
  type: 'plugin'
  id: string
  name: string
  description?: string
  marketplace: string
  scope: UnifiedInstalledScope
  isEnabled: boolean
  errorCount: number
  errors?: PluginError[]
  plugin?: LoadedPlugin
  pendingEnable?: boolean
  pendingUpdate?: boolean
  pendingToggle?: 'will-enable' | 'will-disable'
}

export type FlaggedPluginInfo = {
  type: 'flagged-plugin'
  id: string
  name: string
  marketplace: string
  scope: 'flagged'
  reason: string
  text: string
  flaggedAt: string
}

export type FailedPluginInfo = {
  type: 'failed-plugin'
  id: string
  name: string
  marketplace: string
  scope: PersistablePluginScope
  errorCount: number
  errors: PluginError[]
}

export type UnifiedInstalledMcpItem = {
  type: 'mcp'
  id: string
  name: string
  description?: string
  scope: ConfigScope | 'user'
  status: MCPServerConnection['type']
  client: MCPServerConnection
  indented?: boolean
}

export type UnifiedInstalledItem =
  | PluginListItem
  | FlaggedPluginInfo
  | FailedPluginInfo
  | UnifiedInstalledMcpItem

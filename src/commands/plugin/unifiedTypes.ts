import type { ConfigScope } from '../../services/mcp/types.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { PluginError } from '../../types/plugin.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import type { PersistablePluginScope } from '../../utils/plugins/pluginIdentifier.js'

export type PluginItem = {
  type: 'plugin'
  id: string
  name: string
  description: string | undefined
  marketplace: string
  scope: PersistablePluginScope | 'builtin'
  isEnabled: boolean
  errorCount: number
  errors: PluginError[]
  plugin: LoadedPlugin
  pendingEnable?: boolean
  pendingUpdate?: boolean
  pendingToggle?: 'will-enable' | 'will-disable'
}

export type FailedPluginItem = {
  type: 'failed-plugin'
  id: string
  name: string
  marketplace: string
  scope: PersistablePluginScope
  errorCount: number
  errors: PluginError[]
}

export type McpItem = {
  type: 'mcp'
  id: string
  name: string
  description: string | undefined
  scope: ConfigScope | 'user'
  status: 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed'
  client: MCPServerConnection
  indented?: boolean
}

export type FlaggedPluginItem = {
  type: 'flagged-plugin'
  id: string
  name: string
  marketplace: string
  scope: 'flagged'
  reason: string
  text: string
  flaggedAt: string
}

export type UnifiedInstalledItem =
  | PluginItem
  | FailedPluginItem
  | McpItem
  | FlaggedPluginItem
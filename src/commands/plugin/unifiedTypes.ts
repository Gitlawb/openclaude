import type { MCPServerConnection, ConfigScope } from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import type { PersistablePluginScope } from '../../utils/plugins/pluginIdentifier.js'

export type PluginInstalledScope = PersistablePluginScope | 'builtin'
export type UnifiedPluginScope = PluginInstalledScope | 'flagged' | ConfigScope
export type McpStatus =
  | 'connected'
  | 'disabled'
  | 'pending'
  | 'needs-auth'
  | 'failed'

export type UnifiedInstalledItem =
  | {
      type: 'plugin'
      id: string
      name: string
      description?: string
      marketplace: string
      scope: PluginInstalledScope
      isEnabled: boolean
      errorCount: number
      errors: PluginError[]
      plugin: LoadedPlugin
      pendingEnable?: boolean
      pendingUpdate?: boolean
      pendingToggle?: 'will-enable' | 'will-disable'
    }
  | {
      type: 'failed-plugin'
      id: string
      name: string
      marketplace: string
      scope: PersistablePluginScope
      errorCount: number
      errors: PluginError[]
    }
  | {
      type: 'flagged-plugin'
      id: string
      name: string
      marketplace: string
      scope: 'flagged'
      reason: string
      text: string
      flaggedAt: string
    }
  | {
      type: 'mcp'
      id: string
      name: string
      description?: string
      scope: ConfigScope
      status: McpStatus
      client: MCPServerConnection
      indented?: boolean
    }

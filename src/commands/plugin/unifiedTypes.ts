import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'

export type PluginScope =
  | 'flagged'
  | 'project'
  | 'local'
  | 'user'
  | 'enterprise'
  | 'managed'
  | 'dynamic'
  | 'builtin'
  | (string & {})

export type UnifiedInstalledItem =
  | {
      type: 'plugin'
      id: string
      name: string
      description?: string
      marketplace: string
      scope: PluginScope
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
      scope: PluginScope
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
      scope: string
      status: string
      client: MCPServerConnection
      indented?: boolean
    }

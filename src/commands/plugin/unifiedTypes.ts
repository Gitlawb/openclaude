import type { MCPServerConnection } from '../../services/mcp/types.js'

export type PluginListItem = {
  type: 'plugin'
  id: string
  name: string
  marketplace: string
  isEnabled: boolean
  errorCount: number
  pendingToggle?: 'will-enable' | 'will-disable'
}

export type FlaggedPluginInfo = {
  type: 'flagged-plugin'
  id: string
  name: string
  marketplace: string
}

export type FailedPluginInfo = {
  type: 'failed-plugin'
  id: string
  name: string
  marketplace: string
  errorCount: number
}

export type UnifiedInstalledMcpItem = {
  type: 'mcp'
  name: string
  status: MCPServerConnection['type']
  indented?: boolean
}

export type UnifiedInstalledItem =
  | PluginListItem
  | FlaggedPluginInfo
  | FailedPluginInfo
  | UnifiedInstalledMcpItem

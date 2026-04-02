import type { Tool } from '../../Tool.js'
import type {
  ConfigScope,
  MCPServerConnection,
  McpClaudeAIProxyServerConfig,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js'

export type AgentMcpServerInfo =
  | {
      name: string
      sourceAgents: string[]
      transport: 'stdio'
      command: string
      needsAuth: false
    }
  | {
      name: string
      sourceAgents: string[]
      transport: 'sse' | 'http' | 'ws'
      url: string
      needsAuth: boolean
    }

export type BaseServerInfo = {
  name: string
  client: MCPServerConnection
  scope: ConfigScope
}

export type StdioServerInfo = BaseServerInfo & {
  transport: 'stdio'
  config: McpStdioServerConfig
}

export type SSEServerInfo = BaseServerInfo & {
  transport: 'sse'
  isAuthenticated?: boolean
  config: McpSSEServerConfig
}

export type HTTPServerInfo = BaseServerInfo & {
  transport: 'http'
  isAuthenticated?: boolean
  config: McpHTTPServerConfig
}

export type ClaudeAIServerInfo = BaseServerInfo & {
  transport: 'claudeai-proxy'
  isAuthenticated: false
  config: McpClaudeAIProxyServerConfig
}

export type ServerInfo =
  | StdioServerInfo
  | SSEServerInfo
  | HTTPServerInfo
  | ClaudeAIServerInfo

export type MCPViewState =
  | { type: 'list'; defaultTab?: string }
  | { type: 'server-menu'; server: ServerInfo }
  | { type: 'server-tools'; server: ServerInfo }
  | { type: 'server-tool-detail'; server: ServerInfo; toolIndex: number }
  | { type: 'agent-server-menu'; agentServer: AgentMcpServerInfo }

export type MCPToolWithIndex = {
  tool: Tool
  index: number
}

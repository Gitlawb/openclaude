import { describe, it, expect, mock } from 'bun:test'
import { getCombinedTools, loadReexposedMcpTools } from './mcp.js'
import type { Tool as InternalTool } from '../Tool.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

// Mock the MCP client service to control the tools and connections returned
const mockGetMcpToolsCommandsAndResources = mock(async (onConnectionAttempt: any) => {})
mock.module('../services/mcp/client.js', () => ({
  getMcpToolsCommandsAndResources: mockGetMcpToolsCommandsAndResources
}))

describe('getCombinedTools', () => {
  it('deduplicates builtins when mcpTools have the same name, prioritizing mcpTools', () => {
    const builtinBash = { name: 'Bash', isMcp: false } as unknown as InternalTool
    const builtinRead = { name: 'Read', isMcp: false } as unknown as InternalTool
    const mcpBash = { name: 'Bash', isMcp: true } as unknown as InternalTool

    const builtins = [builtinBash, builtinRead]
    const mcpTools = [mcpBash]

    const result = getCombinedTools(builtins, mcpTools)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(mcpBash)
    expect(result[1]).toBe(builtinRead)
  })
})

describe('loadReexposedMcpTools', () => {
  it('loads tools and clients regardless of connection state (including needs-auth)', async () => {
    // Setup the mock to simulate yielding a needs-auth server and a connected server
    mockGetMcpToolsCommandsAndResources.mockImplementation(async (onConnectionAttempt) => {
      const needsAuthClient = {
        name: 'auth-server',
        type: 'needs-auth',
        config: {}
      } as MCPServerConnection

      const authTool = {
        name: 'mcp__auth-server__authenticate',
        isMcp: true
      } as unknown as InternalTool

      const connectedClient = {
        name: 'connected-server',
        type: 'connected',
        config: {},
        client: {}
      } as MCPServerConnection

      const connectedTool = {
        name: 'mcp__connected-server__do_thing',
        isMcp: true
      } as unknown as InternalTool

      // Simulate the callback behavior
      onConnectionAttempt({ client: needsAuthClient, tools: [authTool], commands: [] })
      onConnectionAttempt({ client: connectedClient, tools: [connectedTool], commands: [] })
    })

    const { mcpClients, mcpTools } = await loadReexposedMcpTools()

    expect(mcpClients).toHaveLength(2)
    expect(mcpClients[0].type).toBe('needs-auth')
    expect(mcpClients[1].type).toBe('connected')

    expect(mcpTools).toHaveLength(2)
    expect(mcpTools[0].name).toBe('mcp__auth-server__authenticate')
    expect(mcpTools[1].name).toBe('mcp__connected-server__do_thing')

    // Reset mock for other tests
    mockGetMcpToolsCommandsAndResources.mockReset()
  })
})

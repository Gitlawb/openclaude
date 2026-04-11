import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { subprocessEnv } from '../../../../utils/subprocessEnv.js'
import type {
  TransportFactory,
  TransportFactoryOptions,
  TransportResult
} from '../types.js'

/**
 * Factory for creating stdio and in-process transports.
 * Handles:
 * - Standard stdio transport (spawning subprocess)
 * - In-process Chrome MCP server
 * - In-process Computer Use MCP server (when CHICAGO_MCP feature is enabled)
 */
export class StdioTransportFactory implements TransportFactory {
  async createTransport(
    name: string,
    serverRef: {
      type?: string
      command?: string
      args?: string[]
      env?: Record<string, string>
    },
    options: TransportFactoryOptions,
  ): Promise<TransportResult> {
    const { feature } = await import('bun:bundle')

    // Check for in-process Chrome MCP server
    const { isClaudeInChromeMCPServer } = await import(
      '../../../../utils/claudeInChrome/common.js'
    )

    if (isClaudeInChromeMCPServer(name)) {
      options.logDebug(`Starting in-process Chrome MCP server`)
      const { createChromeContext } = await import(
        '../../../../utils/claudeInChrome/mcpServer.js'
      )

      let createClaudeForChromeMcpServer: (context: any) => any
      try {
        const chromeMcp = await import('@ant/claude-for-chrome-mcp')
        createClaudeForChromeMcpServer = chromeMcp.createClaudeForChromeMcpServer
      } catch {
        throw new Error(
          'Chrome MCP server requires @ant/claude-for-chrome-mcp. ' +
          'Install it with: npm install @ant/claude-for-chrome-mcp',
        )
      }

      const { createLinkedTransportPair } = await import(
        '../../InProcessTransport.js'
      )

      const context = createChromeContext(serverRef.env)
      const inProcessServer = createClaudeForChromeMcpServer(context)
      const [clientTransport, serverTransport] = createLinkedTransportPair()
      await inProcessServer.connect(serverTransport)
      options.logDebug(`In-process Chrome MCP server started`)

      return {
        transport: clientTransport,
        inProcessServer,
      }
    }

    // Check for in-process Computer Use MCP server (feature-gated)
    if (feature('CHICAGO_MCP')) {
      const { isComputerUseMCPServer } = await import(
        '../../../../utils/computerUse/common.js'
      )
      if (isComputerUseMCPServer(name)) {
        options.logDebug(`Starting in-process Computer Use MCP server`)
        const { createComputerUseMcpServerForCli } = await import(
          '../../../../utils/computerUse/mcpServer.js'
        )
        const { createLinkedTransportPair } = await import(
          '../../InProcessTransport.js'
        )

        const inProcessServer = await createComputerUseMcpServerForCli()
        const [clientTransport, serverTransport] = createLinkedTransportPair()
        await inProcessServer.connect(serverTransport)
        options.logDebug(`In-process Computer Use MCP server started`)

        return {
          transport: clientTransport,
          inProcessServer,
        }
      }
    }

    // Standard stdio transport
    const finalCommand =
      process.env.CLAUDE_CODE_SHELL_PREFIX || serverRef.command
    const finalArgs = process.env.CLAUDE_CODE_SHELL_PREFIX
      ? [[serverRef.command, ...(serverRef.args || [])].join(' ')]
      : serverRef.args

    const transport = new StdioClientTransport({
      command: finalCommand || '',
      args: finalArgs,
      env: {
        ...subprocessEnv(),
        ...serverRef.env,
      } as Record<string, string>,
      stderr: 'pipe',
    })

    return { transport }
  }
}

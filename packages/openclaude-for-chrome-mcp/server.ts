/**
 * OpenClaude for Chrome MCP — Server factory
 *
 * Creates an MCP server that exposes browser automation tools.
 * Tool calls are forwarded to the Chrome extension via the native host socket.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { BROWSER_TOOLS } from './tools.js'
import { SocketClient } from './socketClient.js'
import type { ClaudeForChromeContext } from './types.js'

/**
 * Create an MCP server wired to the Chrome extension via native host socket.
 * The returned server exposes the 17 browser tools and forwards calls to Chrome.
 *
 * Usage (subprocess mode — mcpServer.ts):
 *   const server = createClaudeForChromeMcpServer(context)
 *   await server.connect(new StdioServerTransport())
 *
 * Usage (in-process mode — mcp/client.ts):
 *   const server = createClaudeForChromeMcpServer(context)
 *   const [clientTransport, serverTransport] = createLinkedTransportPair()
 *   await server.connect(serverTransport)
 */
export function createClaudeForChromeMcpServer(
  context: ClaudeForChromeContext,
): Server {
  const server = new Server(
    { name: context.serverName, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  const client = new SocketClient(context)

  // Clean up socket on server shutdown
  server.onclose = () => {
    client.disconnect()
  }

  // ── ListTools ──────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: BROWSER_TOOLS,
  }))

  // ── CallTool ───────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: toolArgs } = request.params

    // Lazy connect on first tool call
    if (!client.isConnected()) {
      try {
        await client.connect()
      } catch (e) {
        context.logger.warn(
          `[OpenClaude Chrome] Failed to connect: ${e}`,
        )
      }
    }

    // If still not connected after attempt, return a user-friendly error
    if (!client.isConnected()) {
      const msg = context.onToolCallDisconnected()
      return {
        content: [{ type: 'text' as const, text: msg }],
        isError: true,
      }
    }

    try {
      context.trackEvent('chrome_tool_call', {
        tool_name: toolName,
      })

      // Forward the tool name as-is. The native host wraps it in an
      // execute_tool envelope (params.tool = toolName) so the Chrome
      // extension service worker can dispatch correctly. The extension
      // expects the full name including any _mcp suffix.
      const response = await client.sendToolRequest(toolName, toolArgs)

      // Handle error responses from the extension
      if (response.error) {
        context.trackEvent('chrome_tool_error', {
          tool_name: toolName,
          error_type: typeof response.error === 'string' ? response.error.slice(0, 100) : 'unknown',
        })
        return {
          content: [
            {
              type: 'text' as const,
              text:
                typeof response.error === 'string'
                  ? response.error
                  : JSON.stringify(response.error),
            },
          ],
          isError: true,
        }
      }

      // Handle screenshot responses (base64 PNG from computer/read_page tools)
      if (response.screenshot && typeof response.screenshot === 'string') {
        const content: Array<
          | { type: 'image'; data: string; mimeType: string }
          | { type: 'text'; text: string }
        > = [
          {
            type: 'image' as const,
            data: response.screenshot,
            mimeType: 'image/png',
          },
        ]

        // Include any accompanying text result
        const textResult = response.result ?? response.text
        if (textResult !== undefined) {
          content.push({
            type: 'text' as const,
            text:
              typeof textResult === 'string'
                ? textResult
                : JSON.stringify(textResult),
          })
        }

        return { content }
      }

      // Standard text response — use result field if present, otherwise
      // strip known meta-keys and serialize the remaining payload
      const { error: _e, screenshot: _s, ...rest } = response
      const result = rest.result !== undefined ? rest.result : rest
      const text =
        typeof result === 'string' ? result : JSON.stringify(result)

      return {
        content: [{ type: 'text' as const, text }],
      }
    } catch (error) {
      context.trackEvent('chrome_tool_error', {
        tool_name: toolName,
        error_type: 'exception',
      })
      context.logger.error(
        `[OpenClaude Chrome] Tool call failed: ${toolName} — ${error}`,
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: `OpenClaude Chrome tool error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  })

  return server
}

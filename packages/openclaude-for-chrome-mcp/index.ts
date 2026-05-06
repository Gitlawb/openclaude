/**
 * OpenClaude for Chrome MCP
 *
 * Local implementation of the Chrome browser automation MCP server
 * for OpenClaude.
 *
 * This package bridges OpenClaude's MCP tool system to the Chrome extension
 * (ID: fcoeoabgfenejglbffodgkkbkcdhcgfn) via the native messaging host socket.
 */

export { BROWSER_TOOLS } from './tools.js'
export { createClaudeForChromeMcpServer } from './server.js'
export type { ClaudeForChromeContext, Logger, PermissionMode } from './types.js'

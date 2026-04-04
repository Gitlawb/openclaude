import type { Command } from '../../../commands.js';
import type { MCPServerConnection, ServerResource } from '../../../services/mcp/types.js';
import type { Tool } from '../../../Tool.js';
export interface ReconnectResult {
  message: string;
  success: boolean;
}

/**
 * Handles the result of a reconnect attempt and returns an appropriate user message
 */
export function handleReconnectResult(result: {
  client: MCPServerConnection;
  tools: Tool[];
  commands: Command[];
  resources?: ServerResource[];
}, serverName: string): ReconnectResult {
  switch (result.client.type) {
    case 'connected':
      return {
        message: `Reconnected to ${serverName}.`,
        success: true
      };
    case 'needs-auth':
      return {
        message: `${serverName} requires authentication. Use the 'Authenticate' option.`,
        success: false
      };
    case 'failed':
      return {
        message: `Failed to reconnect to ${serverName}.`,
        success: false
      };
    default:
      return {
        message: `Unknown result when reconnecting to ${serverName}.`,
        success: false
      };
  }
}

/**
 * Handles errors from reconnect attempts
 */
export function handleReconnectError(error: unknown, serverName: string): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return `Error reconnecting to ${serverName}: ${errorMessage}`;
}

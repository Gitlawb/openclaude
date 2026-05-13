/**
 * OpenClaude for Chrome MCP — Socket protocol types
 *
 * Defines the message format used over the Unix domain socket between
 * this MCP server (client side) and the Chrome native host (server side).
 *
 * Protocol: 4-byte little-endian length prefix followed by a UTF-8 JSON payload.
 * See chromeNativeHost.ts:374-409 for the server-side implementation.
 */

/** Sent from MCP server to native host over the socket. */
export interface ToolRequest {
  method: string
  params?: unknown
}

/**
 * Received from native host over the socket.
 * The native host strips the `type` field from Chrome's `tool_response`
 * before forwarding (chromeNativeHost.ts:299-301).
 */
export interface ToolResponse {
  /** Tool-specific result payload */
  result?: unknown
  /** Error from the Chrome extension — may be a string or structured object */
  error?: string | Record<string, unknown>
  /** Base64-encoded screenshot PNG, returned by computer/read_page tools */
  screenshot?: string
  [key: string]: unknown
}

/**
 * Notification forwarded from Chrome via the native host.
 * The native host strips the `type` field before forwarding.
 * Used for device pairing, connection state, etc.
 */
export interface Notification {
  notificationType?: string
  deviceId?: string
  deviceName?: string
  [key: string]: unknown
}

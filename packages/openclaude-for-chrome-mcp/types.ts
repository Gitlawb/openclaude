/**
 * OpenClaude for Chrome MCP — Type definitions
 *
 * These types match the interface expected by the existing consumers
 * in src/utils/claudeInChrome/mcpServer.ts and src/services/mcp/client.ts.
 */

export interface Logger {
  silly(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export type PermissionMode =
  | 'ask'
  | 'skip_all_permission_checks'
  | 'follow_a_plan'

export interface ClaudeForChromeContext {
  serverName: string
  logger: Logger
  socketPath: string
  getSocketPaths: () => string[]
  clientTypeId: string

  onAuthenticationError: () => void
  onToolCallDisconnected: () => string
  onExtensionPaired: (deviceId: string, name: string) => void
  getPersistedDeviceId: () => string | undefined

  bridgeConfig?: {
    url: string
    getUserId: () => Promise<string | undefined>
    getOAuthToken: () => Promise<string>
    devUserId?: string
  }

  initialPermissionMode?: PermissionMode

  callAnthropicMessages?: (req: {
    model: string
    max_tokens: number
    system: string
    messages: Array<{ role: string; content: unknown }>
    stop_sequences?: string[]
    signal?: AbortSignal
  }) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    stop_reason: string | null
    usage?: { input_tokens: number; output_tokens: number }
  }>

  trackEvent: (
    eventName: string,
    metadata?: Record<string, boolean | number | string | undefined>,
  ) => void
}

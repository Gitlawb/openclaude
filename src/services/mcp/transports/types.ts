import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

// Minimal interface for WebSocket instances passed to mcpWebSocketTransport
export type WsClientLike = {
  readonly readyState: number
  close(): void
  send(data: string): void
}

export interface TransportFactory {
  createTransport(
    name: string,
    serverRef: {
      type?: string
      url?: string
      authToken?: string
      command?: string
      args?: string[]
      env?: Record<string, string>
      id?: string
    },
    options: TransportFactoryOptions,
  ): Promise<TransportResult>
}

export interface TransportFactoryOptions {
  sessionIngressToken?: string | null
  logDebug: (message: string, meta?: Record<string, unknown>) => void
}

export interface TransportResult {
  transport: Transport
  inProcessServer?: InProcessMcpServer | undefined
}

export type InProcessMcpServer = {
  connect(t: Transport): Promise<void>
  close(): Promise<void>
}

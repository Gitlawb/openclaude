declare module 'ws' {
  import type { Server, IncomingMessage } from 'node:http'

  export class WebSocketServer {
    constructor(options: { server: Server })
    on(event: 'connection', listener: (socket: WebSocket, request: IncomingMessage) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
  }

  export class WebSocket {
    static readonly OPEN: number
    readyState: number
    send(data: string): void
    close(code?: number, reason?: string): void
    on(event: string, listener: (...args: unknown[]) => void): this
  }
}

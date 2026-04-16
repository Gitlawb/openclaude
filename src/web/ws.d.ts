declare module 'ws' {
  import type { Server } from 'node:http'

  export class WebSocketServer {
    constructor(options: { server: Server })
    on(event: string, listener: (...args: unknown[]) => void): this
  }

  export class WebSocket {
    static readonly OPEN: number
    readyState: number
    send(data: string): void
    on(event: string, listener: (...args: unknown[]) => void): this
  }
}

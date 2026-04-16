import http from 'node:http'
import { WebSocketServer } from 'ws'
import { getWebUI } from './ui.js'
import { handleHttpRequest } from './routes.js'
import { handleWebSocketConnection } from './wsHandler.js'

export class WebServer {
  private httpServer: http.Server
  private wss: WebSocketServer
  private sessions: Map<string, any[]> = new Map()

  constructor() {
    const html = getWebUI()

    this.httpServer = http.createServer(async (req, res) => {
      const handled = await handleHttpRequest(req, res, html)
      if (handled) return
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    })

    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', (ws: any) => handleWebSocketConnection(ws, this.sessions))
  }

  start(port: number = 3000, host: string = 'localhost') {
    this.httpServer.listen(port, host, () => {
      console.log(`OpenClaude Web running at http://${host}:${port}`)
    })
  }
}

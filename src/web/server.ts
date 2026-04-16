import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { getWebUI } from './ui.js'
import { handleHttpRequest } from './routes.js'
import { handleWebSocketConnection } from './wsHandler.js'
import { SessionStore } from './sessionStore.js'

const COOKIE_NAME = 'openclaude_session'

export class WebServer {
  private httpServer: http.Server
  private wss: WebSocketServer
  private sessionStore = new SessionStore()
  private authToken: string
  private validCookies = new Set<string>()

  constructor() {
    this.authToken = process.env.OPENCLAUDE_AUTH_TOKEN || randomBytes(24).toString('hex')
    const html = getWebUI()

    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const pathname = url.pathname

      if (req.method === 'GET' && (pathname === '/' || pathname === '') && url.searchParams.get('token') === this.authToken) {
        const sessionId = randomBytes(24).toString('hex')
        this.validCookies.add(sessionId)
        res.writeHead(302, {
          'Set-Cookie': `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/`,
          Location: '/',
        })
        res.end()
        return
      }

      if (!this.authenticate(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      const handled = await handleHttpRequest(req, res, html)
      if (handled) return
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    })

    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', (ws, req) => {
      if (!this.authenticate(req)) {
        ws.close(4401, 'Unauthorized')
        return
      }
      handleWebSocketConnection(ws, this.sessionStore)
    })
  }

  private authenticate(req: http.IncomingMessage): boolean {
    const cookie = this.parseCookie(req.headers.cookie)
    if (cookie && this.validCookies.has(cookie)) return true

    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === this.authToken) return true

    return false
  }

  private parseCookie(header: string | undefined): string | null {
    if (!header) return null
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=')
      if (name === COOKIE_NAME) return rest.join('=')
    }
    return null
  }

  start(port: number = 3000, host: string = 'localhost') {
    this.httpServer.listen(port, host, () => {
      console.log(`OpenClaude Web running at http://${host}:${port}?token=${this.authToken}`)
      console.log(`Auth token: ${this.authToken}`)
    })
  }
}

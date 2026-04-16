/**
 * HTTP + WebSocket server for the remote daemon process.
 *
 * Serves:
 *   - Static PWA at `GET /` (reuses localRemoteServer static serving logic)
 *   - `GET /healthz` (unauthenticated — for worker probe)
 *   - `GET /api/sessions` (authenticated — session list)
 *   - `WS /ws/worker?token=…` — inbound from Neural Network processes
 *   - `WS /ws/client?token=…&sessionId=…` — inbound from browsers
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientEntry, WorkerEntry } from './sessionRouter.js'
import { SessionRouter } from './sessionRouter.js'
import type { ClientEvent, WorkerToDaemonEvent } from '../types.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
// After bundling, MODULE_DIR is dist/ (cli.mjs). The build copies client
// assets to dist/client/. In dev mode, they're in src/localRemote/client/.
const CLIENT_DIR_CANDIDATES = [
  resolve(MODULE_DIR, 'client'),
  resolve(MODULE_DIR, '..', 'src', 'localRemote', 'client'),
]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim() || null
  }
  const host = req.headers.host ?? 'localhost'
  try {
    const url = new URL(req.url ?? '/', `http://${host}`)
    const tok = url.searchParams.get('token')
    return tok ? tok.trim() : null
  } catch {
    return null
  }
}

function parseUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? 'localhost'
  try {
    return new URL(req.url ?? '/', `http://${host}`)
  } catch {
    return new URL('/', `http://${host}`)
  }
}

async function findClientFile(relPath: string): Promise<string | null> {
  const clean = normalize(relPath).replace(/^[/\\]+/, '')
  if (clean.includes('..')) return null
  for (const dir of CLIENT_DIR_CANDIDATES) {
    const candidate = join(dir, clean)
    if (!candidate.startsWith(dir + sep) && candidate !== dir) continue
    try {
      const st = await stat(candidate)
      if (st.isFile()) return candidate
    } catch {
      // fall through
    }
  }
  return null
}

export type DaemonServerHandle = {
  close: () => Promise<void>
  router: SessionRouter
  address: { port: number; host: string }
}

export async function createDaemonServer(opts: {
  port: number
  host: string
  token: string
}): Promise<DaemonServerHandle> {
  const router = new SessionRouter()

  const httpServer: HttpServer = createHttpServer((req, res) => {
    const method = req.method ?? 'GET'
    const url = parseUrl(req)
    const pathname = url.pathname

    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('allow', 'GET, HEAD')
      res.end('Method Not Allowed')
      return
    }

    // /healthz — unauthenticated, used by workers to probe daemon.
    if (pathname === '/healthz') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        ok: true,
        role: 'daemon',
        sessions: router.workers.size,
      }))
      return
    }

    // /api/sessions — authenticated.
    if (pathname === '/api/sessions') {
      const supplied = extractToken(req)
      if (!supplied || !timingSafeEqual(supplied, opts.token)) {
        res.statusCode = 401
        res.setHeader('www-authenticate', 'Bearer')
        res.end('Unauthorized')
        return
      }
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.setHeader('access-control-allow-origin', '*')
      res.end(JSON.stringify(router.getSessionList()))
      return
    }

    if (pathname === '/ws/worker' || pathname === '/ws/client') {
      res.statusCode = 426
      res.setHeader('upgrade', 'websocket')
      res.end('Upgrade Required')
      return
    }

    // Static PWA.
    void serveStatic(req, res, pathname)
  })

  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    const url = parseUrl(req)
    const pathname = url.pathname

    if (pathname !== '/ws/worker' && pathname !== '/ws/client') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    const supplied = extractToken(req)
    if (!supplied || !timingSafeEqual(supplied, opts.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nwww-authenticate: Bearer\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, ws => {
      if (pathname === '/ws/worker') {
        handleWorkerSocket(ws, router)
      } else {
        const sessionId = url.searchParams.get('sessionId') ?? ''
        handleClientSocket(ws, router, sessionId)
      }
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (err: Error) => {
      httpServer.off('listening', onListening)
      rejectListen(err)
    }
    const onListening = () => {
      httpServer.off('error', onError)
      resolveListen()
    }
    httpServer.once('error', onError)
    httpServer.once('listening', onListening)
    httpServer.listen(opts.port, opts.host)
  })

  const close = async (): Promise<void> => {
    // Kick all workers.
    for (const [, worker] of router.workers) {
      worker.send({ type: 'kick', code: 4000, reason: 'daemon stopping' })
    }
    // Close all client sockets (handled by wss.close below).
    await new Promise<void>(r => wss.close(() => r()))
    await new Promise<void>(r => httpServer.close(() => r()))
  }

  return {
    close,
    router,
    address: { port: opts.port, host: opts.host },
  }
}

// ─── WebSocket handlers ────────────────────────────────────────────────

function handleWorkerSocket(ws: WebSocket, router: SessionRouter): void {
  let entry: WorkerEntry | null = null

  const send = (event: unknown) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(event)) } catch { /* noop */ }
    }
  }

  ws.on('message', raw => {
    let parsed: WorkerToDaemonEvent
    try {
      parsed = JSON.parse(raw.toString('utf-8'))
    } catch { return }
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return

    if (parsed.type === 'register') {
      entry = router.registerWorker(parsed, send)
      return
    }

    if (!entry) return
    router.handleWorkerEvent(entry.sessionId, parsed)
  })

  const onClose = () => {
    if (entry) {
      router.unregisterWorker(entry.sessionId)
      entry = null
    }
  }
  ws.on('close', onClose)
  ws.on('error', onClose)
}

function handleClientSocket(
  ws: WebSocket,
  router: SessionRouter,
  initialSession: string,
): void {
  const send = (event: unknown) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(event)) } catch { /* noop */ }
    }
  }

  const client: ClientEntry = router.addClient(send, initialSession)

  ws.on('message', raw => {
    let parsed: ClientEvent
    try {
      parsed = JSON.parse(raw.toString('utf-8'))
    } catch { return }
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return
    router.handleClientEvent(client, parsed)
  })

  const onClose = () => router.removeClient(client)
  ws.on('close', onClose)
  ws.on('error', onClose)
}

// ─── Static file serving ───────────────────────────────────────────────

async function serveStatic(
  _req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
  const file = await findClientFile(rel)
  if (!file) {
    res.statusCode = 404
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('Not Found')
    return
  }
  const ext = extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('access-control-allow-origin', '*')
  createReadStream(file).pipe(res)
}

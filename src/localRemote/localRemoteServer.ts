/**
 * HTTP + WebSocket server for the local-remote bridge.
 *
 * - Serves a tiny PWA at `GET /` (index.html, app.js, style.css).
 * - Accepts one WebSocket connection at `/ws`. Authentication is a bearer
 *   token supplied either as an `Authorization: Bearer <token>` header or a
 *   `?token=<token>` query-string parameter (browsers can't set headers on
 *   `new WebSocket(...)`).
 * - Enforces one active connection at a time: a new authenticated client
 *   displaces the previous one with close code 4001 (superseded).
 *
 * This module is transport-only — it does not know about sessions, messages,
 * or permissions. `localRemoteBridge.ts` binds it to the running REPL.
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
import { logForDebugging } from '../utils/debug.js'
import type { ClientEvent, ServerEvent } from './types.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
// When bundled, static assets are copied next to the bundle under
// `localRemote/client/`. When running unbundled (dev), resolve relative to
// this source file. Both cases are checked at request time.
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

export type LocalRemoteServerOptions = {
  port: number
  host: string
  token: string
  onClientMessage: (event: ClientEvent) => void
  onClientConnected: () => void
  onClientDisconnected: () => void
}

export type LocalRemoteServerHandle = {
  send: (event: ServerEvent) => void
  close: () => Promise<void>
  hasClient: () => boolean
  address: { port: number; host: string }
}

/**
 * Constant-time string comparison. Avoids timing leaks for the bearer token.
 */
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

async function findClientFile(relPath: string): Promise<string | null> {
  const clean = normalize(relPath).replace(/^[/\\]+/, '')
  // Reject any path traversal attempt.
  if (clean.includes('..')) return null
  for (const dir of CLIENT_DIR_CANDIDATES) {
    const candidate = join(dir, clean)
    // Defence-in-depth: ensure the resolved path stays under the candidate dir.
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

function serve404(res: ServerResponse): void {
  res.statusCode = 404
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end('Not Found')
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
  const file = await findClientFile(rel)
  if (!file) {
    serve404(res)
    return
  }
  const ext = extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('cache-control', 'no-store')
  // Allow the PWA assets to be loaded from any origin that presents the
  // bearer token later. Static assets themselves are safe to expose.
  res.setHeader('access-control-allow-origin', '*')
  createReadStream(file).pipe(res)
}

export async function createLocalRemoteServer(
  opts: LocalRemoteServerOptions,
): Promise<LocalRemoteServerHandle> {
  const httpServer: HttpServer = createHttpServer((req, res) => {
    const method = req.method ?? 'GET'
    const host = req.headers.host ?? 'localhost'
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', `http://${host}`).pathname
    } catch {
      pathname = '/'
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('allow', 'GET, HEAD')
      res.end('Method Not Allowed')
      return
    }

    if (pathname === '/healthz') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (pathname === '/ws') {
      res.statusCode = 426
      res.setHeader('upgrade', 'websocket')
      res.end('Upgrade Required')
      return
    }

    void serveStatic(req, res, pathname).catch(err => {
      logForDebugging(`[localRemote] static error: ${String(err)}`)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })
  })

  const wss = new WebSocketServer({ noServer: true })

  let activeClient: WebSocket | null = null

  httpServer.on('upgrade', (req, socket, head) => {
    const host = req.headers.host ?? 'localhost'
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', `http://${host}`).pathname
    } catch {
      pathname = '/'
    }
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    const supplied = extractToken(req)
    if (!supplied || !timingSafeEqual(supplied, opts.token)) {
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\nwww-authenticate: Bearer\r\n\r\n',
      )
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, ws => {
      // Displace the previous connection, if any.
      if (activeClient && activeClient.readyState === activeClient.OPEN) {
        try {
          activeClient.close(4001, 'superseded')
        } catch {
          /* noop */
        }
      }
      activeClient = ws
      opts.onClientConnected()

      ws.on('message', raw => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw.toString('utf-8'))
        } catch {
          return
        }
        if (
          parsed === null ||
          typeof parsed !== 'object' ||
          !('type' in parsed)
        ) {
          return
        }
        opts.onClientMessage(parsed as ClientEvent)
      })

      const onCloseOrError = () => {
        if (activeClient === ws) {
          activeClient = null
          opts.onClientDisconnected()
        }
      }
      ws.on('close', onCloseOrError)
      ws.on('error', onCloseOrError)
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

  const send = (event: ServerEvent): void => {
    if (!activeClient || activeClient.readyState !== activeClient.OPEN) return
    try {
      activeClient.send(JSON.stringify(event))
    } catch (err) {
      logForDebugging(`[localRemote] send failed: ${String(err)}`)
    }
  }

  const close = async (): Promise<void> => {
    if (activeClient) {
      try {
        activeClient.close(4000, 'server-stopping')
      } catch {
        /* noop */
      }
      activeClient = null
    }
    await new Promise<void>(resolveClose => {
      wss.close(() => resolveClose())
    })
    await new Promise<void>(resolveClose => {
      httpServer.close(() => resolveClose())
    })
  }

  return {
    send,
    close,
    hasClient: () =>
      activeClient !== null && activeClient.readyState === activeClient.OPEN,
    address: { port: opts.port, host: opts.host },
  }
}

/**
 * Local bridge server — emulates the Anthropic CCR v2 protocol.
 *
 * The existing bridge client code (33 files, ~12K lines) connects to this
 * server transparently via CLAUDE_BRIDGE_BASE_URL=http://localhost:4080.
 *
 * Implements:
 * - Session lifecycle (create, credentials/JWT, heartbeat)
 * - SSE event streaming (worker inbound + client outbound)
 * - Worker event ingestion (outbound from CLI)
 * - Internal events (transcript storage/retrieval)
 * - File upload/serve for SendUserFileTool
 */

import { verifyJwt } from './jwt.js'
import {
  addInternalEvents,
  addWorkerEvents,
  archiveSession,
  checkEpoch,
  createSession,
  getSession,
  heartbeat,
  issueCredentials,
  pushToClientStreams,
  pushToWorkerStream,
  updateWorkerStatus,
} from './sessions.js'
import { getFilePath, storeFile } from './fileStore.js'
import type {
  DeliveryRequest,
  HeartbeatRequest,
  InternalEventsRequest,
  ServerConfig,
  WorkerEventsRequest,
  WorkerInitRequest,
} from './types.js'

// ── Helpers ──────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function err(message: string, status: number): Response {
  return Response.json({ error: { message } }, { status })
}

type JwtResult = { sessionId: string; epoch: number }

function authenticate(req: Request, config: ServerConfig): JwtResult | Response {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return err('Missing authorization', 401)
  const token = auth.slice(7)

  // Accept the local bridge token for session creation (OAuth equivalent)
  if (token === (process.env.CLAUDE_BRIDGE_OAUTH_TOKEN ?? 'openclaude-local-bridge')) {
    return { sessionId: '', epoch: 0 } // OAuth-level auth, no session context
  }

  // Otherwise validate as JWT (for worker endpoints)
  const claims = verifyJwt(token, config.jwtSecret)
  if (!claims) return err('Invalid or expired token', 401)
  return claims
}

function authenticateWorker(req: Request, config: ServerConfig): JwtResult | Response {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return err('Missing authorization', 401)
  const claims = verifyJwt(auth.slice(7), config.jwtSecret)
  if (!claims) return err('Invalid or expired worker JWT', 401)
  return claims
}

function extractSessionId(url: URL): string | null {
  // Match /v1/code/sessions/:id/... or /v1/sessions/:id/...
  const match = url.pathname.match(/\/v1\/(?:code\/)?sessions\/([^/]+)/)
  return match?.[1] ?? null
}

// ── Route handler ────────────────────────────────────────────────────

export function createServer(config: ServerConfig) {
  const { port, host, jwtSecret } = config
  const apiBaseUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`

  return Bun.serve({
    port,
    hostname: host,

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const method = req.method
      const path = url.pathname

      // ── Session creation ───────────────────────────────────────
      if (method === 'POST' && path === '/v1/code/sessions') {
        const authResult = authenticate(req, config)
        if (authResult instanceof Response) return authResult
        const session = createSession()
        return json({ session: { id: session.id } }, 201)
      }

      // ── Bridge credentials (JWT + epoch) ───────────────────────
      if (method === 'POST' && path.match(/^\/v1\/code\/sessions\/[^/]+\/bridge$/)) {
        const authResult = authenticate(req, config)
        if (authResult instanceof Response) return authResult
        const sessionId = extractSessionId(url)
        if (!sessionId) return err('Missing session ID', 400)
        const session = getSession(sessionId)
        if (!session) return err('Session not found', 404)
        const creds = issueCredentials(session, jwtSecret, apiBaseUrl)
        return json(creds)
      }

      // ── Worker init / state report ─────────────────────────────
      if (method === 'PUT' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker$/)) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        const session = getSession(authResult.sessionId)
        if (!session) return err('Session not found', 404)
        const body = (await req.json()) as WorkerInitRequest
        if (!checkEpoch(session, body.worker_epoch)) {
          return err('Epoch mismatch', 409)
        }
        updateWorkerStatus(
          session,
          body.worker_status,
          body.external_metadata,
        )
        return json({})
      }

      // ── Worker heartbeat ───────────────────────────────────────
      if (method === 'POST' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker\/heartbeat$/)) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        const session = getSession(authResult.sessionId)
        if (!session) return err('Session not found', 404)
        const body = (await req.json()) as HeartbeatRequest
        if (!checkEpoch(session, body.worker_epoch)) {
          return err('Epoch mismatch', 409)
        }
        heartbeat(session)
        return json({})
      }

      // ── SSE stream (inbound to worker) ─────────────────────────
      if (method === 'GET' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker\/events\/stream$/)) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        const session = getSession(authResult.sessionId)
        if (!session) return err('Session not found', 404)

        const fromSeq = parseInt(url.searchParams.get('from_sequence_num') ?? '0', 10)

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // Register as the worker's inbound stream
            session.workerStream = controller

            // Replay events after fromSeq
            for (const evt of session.events) {
              if (evt.sequenceNum > fromSeq && evt.source === 'client') {
                const frame = `event: client_event\nid: ${evt.sequenceNum}\ndata: ${JSON.stringify({
                  event_id: evt.eventId,
                  sequence_num: evt.sequenceNum,
                  event_type: evt.eventType,
                  source: evt.source,
                  payload: evt.payload,
                  created_at: evt.createdAt,
                })}\n\n`
                controller.enqueue(new TextEncoder().encode(frame))
              }
            }

            // Keepalive every 15s
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(new TextEncoder().encode(':keepalive\n\n'))
              } catch {
                clearInterval(keepalive)
              }
            }, 15_000)

            // Cleanup on abort
            req.signal.addEventListener('abort', () => {
              clearInterval(keepalive)
              if (session.workerStream === controller) {
                session.workerStream = null
              }
              try { controller.close() } catch { /* already closed */ }
            })
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      // ── Worker events (outbound from CLI) ──────────────────────
      if (method === 'POST' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker\/events$/) && !path.includes('internal') && !path.includes('delivery')) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        const session = getSession(authResult.sessionId)
        if (!session) return err('Session not found', 404)
        const body = (await req.json()) as WorkerEventsRequest
        if (!checkEpoch(session, body.worker_epoch)) {
          return err('Epoch mismatch', 409)
        }
        const added = addWorkerEvents(session, body.events)
        // Push to connected client streams
        for (const evt of added) {
          pushToClientStreams(session, evt)
        }
        return json({})
      }

      // ── Internal events (POST) ─────────────────────────────────
      if (method === 'POST' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker\/internal-events$/)) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        const session = getSession(authResult.sessionId)
        if (!session) return err('Session not found', 404)
        const body = (await req.json()) as InternalEventsRequest
        if (!checkEpoch(session, body.worker_epoch)) {
          return err('Epoch mismatch', 409)
        }
        addInternalEvents(session, body.events)
        return json({})
      }

      // ── Internal events (GET) ──────────────────────────────────
      if (method === 'GET' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker\/internal-events$/)) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        const session = getSession(authResult.sessionId)
        if (!session) return err('Session not found', 404)
        const cursor = url.searchParams.get('cursor')
        const startIdx = cursor ? parseInt(cursor, 10) : 0
        const page = session.internalEvents.slice(startIdx, startIdx + 100)
        const nextCursor = startIdx + page.length < session.internalEvents.length
          ? String(startIdx + page.length)
          : undefined
        return json({
          data: page.map((e) => ({
            event_id: e.eventId,
            event_type: e.eventType,
            payload: e.payload,
            event_metadata: null,
            is_compaction: e.isCompaction ?? false,
            created_at: e.createdAt,
            agent_id: e.agentId,
          })),
          ...(nextCursor ? { next_cursor: nextCursor } : {}),
        })
      }

      // ── Delivery ACK ───────────────────────────────────────────
      if (method === 'POST' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker\/events\/delivery$/)) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        // Accept and ignore — delivery tracking is informational
        await req.json()
        return json({})
      }

      // ── Worker state GET ───────────────────────────────────────
      if (method === 'GET' && path.match(/^\/v1\/code\/sessions\/[^/]+\/worker$/) && !path.includes('events')) {
        const authResult = authenticateWorker(req, config)
        if (authResult instanceof Response) return authResult
        const session = getSession(authResult.sessionId)
        if (!session) return err('Session not found', 404)
        return json({
          worker: { external_metadata: session.metadata },
        })
      }

      // ── Session archive ────────────────────────────────────────
      if (method === 'POST' && path.match(/^\/v1\/sessions\/[^/]+\/archive$/)) {
        const sessionId = path.match(/\/v1\/sessions\/([^/]+)\/archive/)?.[1]
        if (sessionId) {
          // Handle session_* → cse_* retag
          const cseId = sessionId.startsWith('session_')
            ? `cse_${sessionId.slice('session_'.length)}`
            : sessionId
          archiveSession(cseId)
        }
        return json({})
      }

      // ── File upload ────────────────────────────────────────────
      if (method === 'POST' && path === '/api/oauth/file_upload') {
        try {
          const formData = await req.formData()
          const file = formData.get('file')
          if (!file || !(file instanceof Blob)) {
            return err('Missing file field', 400)
          }
          const uuid = await storeFile(file)
          return json({ file_uuid: uuid })
        } catch (e) {
          return err(`Upload failed: ${e}`, 500)
        }
      }

      // ── File serve ─────────────────────────────────────────────
      if (method === 'GET' && path.startsWith('/files/')) {
        const uuid = path.slice('/files/'.length)
        const filePath = getFilePath(uuid)
        if (!filePath) return err('File not found', 404)
        return new Response(Bun.file(filePath))
      }

      // ── Client SSE stream (for future web UI) ──────────────────
      if (method === 'GET' && path.match(/^\/v1\/code\/sessions\/[^/]+\/client\/stream$/)) {
        const sessionId = extractSessionId(url)
        if (!sessionId) return err('Missing session ID', 400)
        const session = getSession(sessionId)
        if (!session) return err('Session not found', 404)

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            session.clientStreams.add(controller)

            // Replay existing worker events
            for (const evt of session.events) {
              if (evt.source === 'worker') {
                const frame = `event: worker_event\nid: ${evt.sequenceNum}\ndata: ${JSON.stringify({
                  event_id: evt.eventId,
                  sequence_num: evt.sequenceNum,
                  event_type: evt.eventType,
                  payload: evt.payload,
                  created_at: evt.createdAt,
                })}\n\n`
                controller.enqueue(new TextEncoder().encode(frame))
              }
            }

            const keepalive = setInterval(() => {
              try {
                controller.enqueue(new TextEncoder().encode(':keepalive\n\n'))
              } catch {
                clearInterval(keepalive)
              }
            }, 15_000)

            req.signal.addEventListener('abort', () => {
              clearInterval(keepalive)
              session.clientStreams.delete(controller)
              try { controller.close() } catch { /* already closed */ }
            })
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      // ── Client message POST (for future web UI) ────────────────
      if (method === 'POST' && path.match(/^\/v1\/code\/sessions\/[^/]+\/client\/events$/)) {
        const sessionId = extractSessionId(url)
        if (!sessionId) return err('Missing session ID', 400)
        const session = getSession(sessionId)
        if (!session) return err('Session not found', 404)
        const body = (await req.json()) as { events: Array<{ payload: Record<string, unknown> }> }
        for (const { payload } of body.events) {
          const evt = addWorkerEvents(session, [{ payload }])[0]!
          // Mark as client-sourced so the worker SSE replays it
          ;(evt as any).source = 'client'
          pushToWorkerStream(session, evt)
        }
        return json({})
      }

      // ── Health check ───────────────────────────────────────────
      if (method === 'GET' && (path === '/health' || path === '/')) {
        return json({ status: 'ok', bridge: 'local' })
      }

      return err(`Not found: ${method} ${path}`, 404)
    },
  })
}

import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { init } from './init.js'
import { QueryEngine } from '../QueryEngine.js'
import { getTools } from '../tools.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import { FileStateCache, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js'
import { getGlobalConfig } from '../utils/config.js'
import { getPrimaryModel } from '../utils/providerModels.js'
import { 
  getActiveProviderProfile, 
  applyProviderProfileToProcessEnv 
} from '../utils/providerProfiles.js'

// Polyfill MACRO if not present
if (!(globalThis as any).MACRO) {
  Object.assign(globalThis, {
    MACRO: {
      VERSION: '0.12.1',
      DISPLAY_VERSION: '0.12.1',
      PACKAGE_URL: '@gitlawb/openclaude',
    }
  })
}

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000
const AUTH_TOKEN = process.env.OPENCLAUDE_WEB_TOKEN || randomBytes(16).toString('hex')
const WEB_DIST_PATH = existsSync(resolve(__dirname, '../web/dist')) 
  ? resolve(__dirname, '../web/dist')
  : resolve(__dirname, '../../web/dist')

async function main() {
  console.log('🚀 Starting OpenClaude Web Console...')
  console.log(`📂 Web assets path: ${WEB_DIST_PATH}`)
  await init()

  const app = new Hono()

  // Authentication Middleware
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token') || c.req.header('Authorization')?.replace('Bearer ', '')
    
    // Allow serving the login/root page if we wanted, but here we require token for EVERYTHING
    // including static assets for maximum security.
    if (token !== AUTH_TOKEN) {
      return c.text('Unauthorized: Missing or invalid token', 401)
    }
    await next()
  })

  // Static files with SPA fallback
  app.use('*', serveStatic({ 
    root: WEB_DIST_PATH,
    rewriteRequestPath: (path) => {
      const fullPath = join(WEB_DIST_PATH, path)
      if (path === '/' || !existsSync(fullPath)) {
        return '/index.html'
      }
      return path
    }
  }))

  // Start the server (bind to localhost by default for security)
  const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '127.0.0.1' 
  }, (info) => {
    console.log(`✨ OpenClaude Web Console available at http://${info.address}:${info.port}/?token=${AUTH_TOKEN}`)
    console.log('🔒 Security: Token authentication is enabled.')
  })

  // Set up WebSockets using 'ws' package
  const wss = new WebSocketServer({ noServer: true })

  // @ts-ignore
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`)
    const token = url.searchParams.get('token')

    if (token !== AUTH_TOKEN) {
      console.log('⚠️ Rejected unauthorized WebSocket upgrade request')
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    console.log(`🔌 Upgrade request authorized for: ${request.url}`)
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws: WebSocket) => {
    console.log('📱 New client connected via WebSocket')
    
    const fileCache = new FileStateCache(READ_FILE_STATE_CACHE_SIZE, 25 * 1024 * 1024)
    let appState = getDefaultAppState()
    
    const config = getGlobalConfig()
    const activeProfile = getActiveProviderProfile(config)
    if (activeProfile) {
      applyProviderProfileToProcessEnv(activeProfile)
      appState.mainLoopModel = activeProfile.model
    }

    const currentModel = getPrimaryModel(appState.mainLoopModel) || 'Claude'
    const version = (globalThis as any).MACRO.DISPLAY_VERSION || (globalThis as any).MACRO.VERSION
    
    ws.send(JSON.stringify({ type: 'init', model: currentModel, version }))

    let engine: QueryEngine | null = null

    ws.on('message', async (message) => {
      try {
        const payload = JSON.parse(message.toString())
        if (payload.type === 'ready') return

        if (payload.type === 'chat') {
          const { message: text, model } = payload

          engine = new QueryEngine({
            cwd: process.cwd(),
            tools: getTools(appState.toolPermissionContext),
            commands: [],
            mcpClients: [],
            agents: [],
            includePartialMessages: true,
            getAppState: () => appState,
            setAppState: (updater) => { appState = updater(appState) },
            readFileCache: fileCache,
            userSpecifiedModel: model,
            fallbackModel: model,
          })

          const generator = engine.submitMessage(text)

          for await (const msg of generator) {
            if (msg.type === 'stream_event') {
              ws.send(JSON.stringify(msg))
            } else if (msg.type === 'result') {
              ws.send(JSON.stringify({ type: 'done', result: msg.result }))
            }
          }
        }
      } catch (err) {
        console.error('❌ WS Message Error:', err)
      }
    })

    ws.on('close', () => {
      console.log('🔌 Client disconnected')
      if (engine) engine.interrupt()
    })
    
    ws.on('error', (err) => {
      console.error('❌ WebSocket Error:', err)
    })
  })
}

main().catch(console.error)

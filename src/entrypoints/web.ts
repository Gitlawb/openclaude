import { join, resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { init } from './init.js'
import { QueryEngine } from '../QueryEngine.js'
import { getTools } from '../tools.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import { FileStateCache, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js'
import { getGlobalConfig } from '../utils/config.js'
import { getGlobalClaudeFile } from '../utils/env.js'
import { getPrimaryModel } from '../utils/providerModels.js'
import { 
  getProviderProfiles,
  getActiveProviderProfile, 
  applyProviderProfileToProcessEnv 
} from '../utils/providerProfiles.js'
import { fileURLToPath } from 'node:url'

// Polyfill MACRO
Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.12.1',
    DISPLAY_VERSION: '0.12.1',
    PACKAGE_URL: '@gitlawb/openclaude',
  }
})

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000
const WEB_DIST_PATH = existsSync(resolve(__dirname, '../web/dist')) 
  ? resolve(__dirname, '../web/dist')
  : resolve(__dirname, '../../web/dist')

async function main() {
  console.log('🚀 Starting OpenClaude Web Console (Bun Server)...')
  console.log(`📂 Web assets path: ${WEB_DIST_PATH}`)
  await init()

  const server = Bun.serve({
    port: PORT,
    fetch(req, server) {
      const url = new URL(req.url)
      
      // Handle WebSocket upgrade
      if (server.upgrade(req)) {
        return
      }

      // Handle Static Files
      let path = url.pathname === '/' ? '/index.html' : url.pathname
      let filePath = join(WEB_DIST_PATH, path)
      
      if (!existsSync(filePath)) {
        filePath = join(WEB_DIST_PATH, 'index.html')
      }

      console.log(`📡 HTTP ${req.method} ${url.pathname}`)
      return new Response(Bun.file(filePath))
    },
    websocket: {
      open(ws) {
        console.log('📱 New client connected via Bun WS')
        
        const fileCache = new FileStateCache(READ_FILE_STATE_CACHE_SIZE, 25 * 1024 * 1024)
        let appState = getDefaultAppState()
        
        // Resolve real active profile
        const config = getGlobalConfig()
        const activeProfile = getActiveProviderProfile(config)
        if (activeProfile) {
          applyProviderProfileToProcessEnv(activeProfile)
          appState.mainLoopModel = activeProfile.model
        }

        const currentModel = getPrimaryModel(appState.mainLoopModel) || 'Claude'
        const version = (globalThis as any).MACRO.DISPLAY_VERSION || (globalThis as any).MACRO.VERSION
        
        console.log(`✉️ Sending init to client: ${currentModel}`)
        ws.send(JSON.stringify({ type: 'init', model: currentModel, version }))

        // Store state in the socket object
        ws.data = { appState, fileCache, engine: null }
      },
      async message(ws, message) {
        const payload = JSON.parse(message.toString())
        console.log('📩 RECEIVED:', payload.type)

        if (payload.type === 'ready') return

        if (payload.type === 'chat') {
          const { message: text, model } = payload
          const { appState, fileCache } = ws.data as any

          const engine = new QueryEngine({
            cwd: process.cwd(),
            tools: getTools(appState.toolPermissionContext),
            commands: [],
            mcpClients: [],
            agents: [],
            includePartialMessages: true,
            getAppState: () => appState,
            setAppState: (updater) => { ws.data.appState = updater(appState) },
            readFileCache: fileCache,
            userSpecifiedModel: model,
            fallbackModel: model,
          })

          ws.data.engine = engine
          const generator = engine.submitMessage(text)

          for await (const msg of generator) {
            if (msg.type === 'stream_event') {
              ws.send(JSON.stringify(msg))
            } else if (msg.type === 'result') {
              ws.send(JSON.stringify({ type: 'done', result: msg.result }))
            }
          }
        }
      },
      close(ws) {
        console.log('🔌 Client disconnected')
        if ((ws.data as any).engine) (ws.data as any).engine.interrupt()
      }
    }
  })

  console.log(`✨ OpenClaude Web Console available at ${server.url}`)
}

main().catch(console.error)

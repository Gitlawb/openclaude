/**
 * Internal Qwen OAuth proxy server — built into OpenClaude.
 *
 * Starts an HTTP server on localhost that handles:
 * - Reading ~/.claude/qwen-oauth.json
 * - Auto-refreshing tokens before expiry
 * - Forwarding requests to DashScope with correct headers
 * - Using Node.js https.Agent for proper TLS fingerprint
 * - Model alias resolution (coder-model → qwen3-coder-plus)
 * - max_tokens clamping per model limits
 *
 * Port rotation: tries 8080-8099 until a free port is found.
 * Stores the active port in ~/.claude/qwen-proxy-port.json so
 * multiple OpenClaude instances can discover and reuse it.
 * Auto-cleanup: proxy stops on process exit/SIGINT/SIGTERM.
 *
 * This replaces the need for the external qwen-code-oai-proxy.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import axios, { type AxiosResponse } from 'axios'
import {
  loadQwenCredentials,
  shouldRefreshQwenToken,
  refreshQwenAccessToken,
  type QwenCredentials,
} from './qwenAuth.js'

// ============================================================
// Constants
// ============================================================

export const QWEN_PROXY_PORT_MIN = 8080
export const QWEN_PROXY_PORT_MAX = 8099

const CLAUDE_DIR = join(homedir(), '.claude')
const PORT_FILE = join(CLAUDE_DIR, 'qwen-proxy-port.json')

// Fallback if resource_url is not in credentials
const DEFAULT_QWEN_API_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const TOKEN_REFRESH_BUFFER_MS = 30 * 1000

// Model aliases — same as qwen-code-oai-proxy
const MODEL_ALIASES: Record<string, string> = {
  'qwen3.5-plus': 'qwen3-coder-plus',
  'qwen3.6-plus': 'qwen3-coder-plus',
  'coder-model': 'qwen3-coder-plus',
}

// Max output tokens per model — same as qwen-code-oai-proxy
const MODEL_LIMITS: Record<string, { maxTokens: number }> = {
  'vision-model': { maxTokens: 32768 },
  'qwen3-vl-plus': { maxTokens: 32768 },
  'qwen3-vl-max': { maxTokens: 32768 },
  'qwen3.5-plus': { maxTokens: 65536 },
  'qwen3.6-plus': { maxTokens: 65536 },
  'qwen3-coder-plus': { maxTokens: 65536 },
  'qwen3-coder-flash': { maxTokens: 65536 },
}

// Available models — returned by /v1/models
const QWEN_MODELS = [
  { id: 'qwen3-coder-plus', object: 'model', created: 1754686206, owned_by: 'qwen' },
  { id: 'qwen3-coder-flash', object: 'model', created: 1754686206, owned_by: 'qwen' },
  { id: 'qwen3.5-plus', object: 'model', created: 1754686206, owned_by: 'qwen' },
  { id: 'qwen3.6-plus', object: 'model', created: 1754686206, owned_by: 'qwen' },
  { id: 'coder-model', object: 'model', created: 1754686206, owned_by: 'qwen' },
  { id: 'vision-model', object: 'model', created: 1754686206, owned_by: 'qwen' },
]

// ============================================================
// HTTPS Agent — exact same config as qwen-code-oai-proxy
// ============================================================

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketTimeout: 30000,
} as any)

// ============================================================
// Port discovery & state management
// ============================================================

/**
 * Check if a port is available by trying to bind to it.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.on('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * Find the first available port in range [QWEN_PROXY_PORT_MIN, QWEN_PROXY_PORT_MAX].
 */
async function findAvailablePort(): Promise<number | null> {
  for (let port = QWEN_PROXY_PORT_MIN; port <= QWEN_PROXY_PORT_MAX; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  return null
}

/**
 * Read the stored port from the port file.
 */
function readStoredPort(): number | null {
  try {
    if (!existsSync(PORT_FILE)) return null
    const raw = readFileSync(PORT_FILE, 'utf8')
    const data = JSON.parse(raw)
    // Validate: port must be in range and file must be recent (last 24h)
    if (typeof data.port !== 'number' || data.port < QWEN_PROXY_PORT_MIN || data.port > QWEN_PROXY_PORT_MAX) {
      return null
    }
    const age = Date.now() - (data.timestamp || 0)
    if (age > 24 * 60 * 60 * 1000) {
      return null // Stale, ignore
    }
    return data.port
  } catch {
    return null
  }
}

/**
 * Store the active port to the port file.
 */
function storePort(port: number): void {
  try {
    mkdirSync(CLAUDE_DIR, { recursive: true })
    writeFileSync(PORT_FILE, JSON.stringify({ port, timestamp: Date.now() }), 'utf8')
  } catch {
    // Non-critical, ignore
  }
}

/**
 * Check if the proxy is already running by pinging the stored port.
 */
async function pingStoredPort(): Promise<boolean> {
  const port = readStoredPort()
  if (!port) return false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`http://localhost:${port}/v1/models`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

// ============================================================
// Token management with caching
// ============================================================

let cachedCredentials: QwenCredentials | null = null
let lastCredentialsLoad = 0
const CREDENTIALS_CACHE_MS = 5000

async function getCredentials(): Promise<QwenCredentials> {
  const now = Date.now()
  if (cachedCredentials && now - lastCredentialsLoad < CREDENTIALS_CACHE_MS) {
    if (shouldRefreshQwenToken(cachedCredentials)) {
      cachedCredentials = await refreshQwenAccessToken(cachedCredentials)
    }
    return cachedCredentials
  }

  const creds = loadQwenCredentials()
  if (!creds) {
    throw new Error(
      'No Qwen credentials found. Authenticate via /provider → Qwen Coder',
    )
  }

  cachedCredentials = creds
  lastCredentialsLoad = now

  if (shouldRefreshQwenToken(creds)) {
    cachedCredentials = await refreshQwenToken(creds)
  }

  return cachedCredentials!
}

// ============================================================
// Build DashScope headers — exact same as qwen-code-oai-proxy
// ============================================================

function buildDashScopeHeaders(accessToken: string, isStreaming = false): Record<string, string> {
  const headers: Record<string, string> = {
    'connection': 'keep-alive',
    'accept': isStreaming ? 'text/event-stream' : 'application/json',
    'authorization': `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'user-agent': 'QwenCode/0.11.1 (linux; x64)',
    'x-dashscope-authtype': 'qwen-oauth',
    'x-dashscope-cachecontrol': 'enable',
    'x-dashscope-useragent': 'QwenCode/0.11.1 (linux; x64)',
    'x-stainless-arch': 'x64',
    'x-stainless-lang': 'js',
    'x-stainless-os': 'Linux',
    'x-stainless-package-version': '5.11.0',
    'x-stainless-retry-count': '1',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': 'v18.19.1',
    'accept-language': '*',
    'sec-fetch-mode': 'cors',
  }
  return headers
}

// ============================================================
// Request processing — exact same logic as qwen-code-oai-proxy
// ============================================================

/**
 * Build the API endpoint from credentials — same logic as qwen-code-oai-proxy.
 * Uses resource_url from ~/.claude/qwen-oauth.json (e.g. "portal.qwen.ai").
 */
function getApiEndpoint(credentials: QwenCredentials): string {
  if (credentials.resourceUrl) {
    let endpoint = credentials.resourceUrl
    if (!endpoint.startsWith('http')) {
      endpoint = `https://${endpoint}`
    }
    if (!endpoint.endsWith('/v1')) {
      endpoint = endpoint.endsWith('/') ? `${endpoint}v1` : `${endpoint}/v1`
    }
    return endpoint
  }
  return DEFAULT_QWEN_API_BASE_URL
}

function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] || model
}

function clampMaxTokens(model: string, maxTokens: number | undefined): number | undefined {
  if (maxTokens === undefined) return undefined
  const limit = MODEL_LIMITS[model]
  if (limit && maxTokens > limit.maxTokens) {
    return limit.maxTokens
  }
  return maxTokens
}

function resolveThinkingParams(request: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (request.enable_thinking !== undefined) {
    result.enable_thinking = request.enable_thinking
  }
  if (request.thinking_budget !== undefined) {
    result.thinking_budget = request.thinking_budget
  }

  if (request.reasoning && typeof request.reasoning === 'object') {
    const effort = (request.reasoning as any).effort
    if (effort === 'none') {
      result.enable_thinking = false
    } else if (effort === 'low') {
      result.enable_thinking = true
      result.thinking_budget = 1024
    } else if (effort === 'medium') {
      result.enable_thinking = true
      result.thinking_budget = 8192
    } else if (effort === 'high') {
      result.enable_thinking = true
      // high = null (no budget limit)
    }
  }

  return result
}

function buildDashScopePayload(request: Record<string, unknown>): Record<string, unknown> {
  const model = resolveModelAlias((request.model as string) || 'qwen3-coder-plus')
  const maxTokens = clampMaxTokens(model, request.max_tokens as number | undefined)

  const payload: Record<string, unknown> = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: maxTokens,
    top_p: request.top_p,
    top_k: request.top_k,
    repetition_penalty: request.repetition_penalty,
    stream: request.stream ?? false,
    ...resolveThinkingParams(request),
  }

  if (request.tools && Array.isArray(request.tools) && request.tools.length > 0) {
    payload.tools = request.tools
  }
  if (request.tool_choice) {
    payload.tool_choice = request.tool_choice
  }

  return payload
}

// ============================================================
// Request handler
// ============================================================

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url || '/'

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  // /v1/models — return available Qwen models
  if (url === '/v1/models' || url === '/v1/models/') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({
      object: 'list',
      data: QWEN_MODELS,
    }))
    return
  }

  // /v1/chat/completions — forward to DashScope
  if (url === '/v1/chat/completions' || url === '/v1/chat/completions/') {
    if (req.method !== 'POST') {
      res.writeHead(405, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ error: { message: 'Method not allowed', type: 'invalid_request_error' } }))
      return
    }

    // Read body
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }))
      return
    }

    const isStreaming = parsed.stream === true

    try {
      const credentials = await getCredentials()
      const accessToken = credentials.accessToken
      const apiEndpoint = getApiEndpoint(credentials)
      const payload = buildDashScopePayload(parsed)

      const response: AxiosResponse = await axios.post(
        `${apiEndpoint}/chat/completions`,
        payload,
        {
          headers: buildDashScopeHeaders(accessToken, isStreaming),
          responseType: 'text',
          transformResponse: [(data: string) => data],
          timeout: 300000,
          httpsAgent,
        },
      )

      res.writeHead(response.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(response.data)
    } catch (error: any) {
      const status = error.response?.status || 500
      const bodyText = error.response?.data
      const parsedError = typeof bodyText === 'string' ? (() => {
        try { return JSON.parse(bodyText) } catch { return { error: { message: bodyText, type: 'internal_error' } } }
      })() : (bodyText || { error: { message: error.message, type: 'internal_error' } })

      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify(parsedError))
    }
    return
  }

  // Unknown route
  res.writeHead(404, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify({ error: { message: 'Not found', type: 'invalid_request_error' } }))
}

// ============================================================
// Server lifecycle
// ============================================================

let proxyServer: ReturnType<typeof createServer> | null = null
let activePort: number | null = null

export function getActiveQwenProxyPort(): number | null {
  return activePort
}

export function getQwenProxyBaseUrl(): string {
  const port = activePort || readStoredPort() || QWEN_PROXY_PORT_MIN
  return `http://localhost:${port}/v1`
}

export function isQwenProxyRunning(): boolean {
  return proxyServer !== null && proxyServer.listening
}

/**
 * Start the Qwen proxy with port rotation and auto-cleanup.
 * Tries ports 8080-8099. Reuses an existing running proxy if found.
 */
export async function startQwenProxy(): Promise<string> {
  // Check if a proxy is already running on the stored port
  if (await pingStoredPort()) {
    const port = readStoredPort()!
    activePort = port
    return `http://localhost:${port}/v1`
  }

  // Close any previously running proxy in this process
  if (proxyServer) {
    await stopQwenProxy()
  }

  // Find an available port
  const port = await findAvailablePort()
  if (!port) {
    throw new Error(
      `No available port in range ${QWEN_PROXY_PORT_MIN}-${QWEN_PROXY_PORT_MAX} for Qwen proxy. ` +
      `Another process may be using all ports in this range.`,
    )
  }

  // Validate credentials before starting
  const creds = loadQwenCredentials()
  if (!creds || !creds.accessToken) {
    throw new Error(
      'No Qwen credentials found. Authenticate via /provider → Qwen Coder',
    )
  }

  return new Promise((resolve, reject) => {
    proxyServer = createServer(handleRequest)

    proxyServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try again or close the other process.`))
      } else {
        reject(err)
      }
    })

    proxyServer.listen(port, '127.0.0.1', () => {
      activePort = port
      storePort(port)

      // Register cleanup handlers
      registerCleanupHandlers()

      resolve(`http://localhost:${port}/v1`)
    })
  })
}

export async function stopQwenProxy(): Promise<void> {
  if (!proxyServer) return

  return new Promise<void>((resolve) => {
    proxyServer!.close(() => {
      proxyServer = null
      activePort = null
      resolve()
    })
  })
}

// ============================================================
// Cleanup on process exit
// ============================================================

let cleanupRegistered = false

function registerCleanupHandlers(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true

  const cleanup = () => {
    if (proxyServer) {
      proxyServer.close()
      proxyServer = null
      activePort = null
    }
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('exit', cleanup)
}

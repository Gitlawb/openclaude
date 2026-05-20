#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(SCRIPT_DIR, '../..')
const STATE_DIR = path.join(ROOT_DIR, '.tmp-control-center')
const ENV_PATH = path.join(ROOT_DIR, '.env')
const CONFIG_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.openclaude')
const CONFIG_PATH = path.join(CONFIG_HOME, 'agent-gateway.json')
const OPENWEBUI_DATA_DIR = path.join(CONFIG_HOME, 'open-webui-data')
const OPENRAG_REPO_DIR = path.join(CONFIG_HOME, 'openrag')
const OPENRAG_WORKSPACE_DIR = path.join(CONFIG_HOME, 'openrag-workspace')
const OPENRAG_DOCUMENTS_DIR = path.join(CONFIG_HOME, 'openrag-documents')
const OPENRAG_MCP_BRIDGE = path.join(SCRIPT_DIR, 'openrag-mcp-bridge.cjs')
const OPENRAG_MCP_BRIDGE_ARG = 'scripts/release/openrag-mcp-bridge.cjs'
const CAMOFOX_MCP_BRIDGE = path.join(SCRIPT_DIR, 'camofox-mcp-bridge.cjs')
const CAMOFOX_MCP_BRIDGE_ARG = 'scripts/release/camofox-mcp-bridge.cjs'
const HINDSIGHT_MCP_BRIDGE = path.join(SCRIPT_DIR, 'hindsight-mcp-bridge.cjs')
const HINDSIGHT_MCP_BRIDGE_ARG = 'scripts/release/hindsight-mcp-bridge.cjs'
const MCP_CONFIG_PATH = path.join(ROOT_DIR, '.mcp.json')
const CONTROL_PORT = Number(process.env.OPENCLAUDE_CONTROL_CENTER_PORT || 8799)
const ARGS = new Set(process.argv.slice(2))
const NO_OPEN = ARGS.has('--no-open') || process.env.OPENCLAUDE_CONTROL_CENTER_NO_OPEN === '1'

if (ARGS.has('--help') || ARGS.has('-h')) {
  console.log(`OpenClaude Control Center

Usage:
  node scripts/release/control-center.mjs [--no-open]

Environment:
  OPENCLAUDE_CONTROL_CENTER_PORT=8799
  OPENCLAUDE_CONTROL_CENTER_NO_OPEN=1
`)
  process.exit(0)
}

const PROVIDERS = [
  { value: 'openai-compatible', label: 'OpenAI compatible', flag: 'openai' },
  {
    value: 'abacus',
    label: 'Abacus RouteLLM',
    flag: 'openai',
    baseUrl: 'https://routellm.abacus.ai/v1',
    models: ['route-llm', 'gpt-5.5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-7-xhigh', 'claude-sonnet-4-6'],
  },
  { value: 'onlysq', label: 'OnlySQ', flag: 'openai', baseUrl: 'https://api.onlysq.ru/ai/openai' },
  { value: 'openai', label: 'OpenAI', flag: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { value: 'openrouter', label: 'OpenRouter', flag: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { value: 'deepseek', label: 'DeepSeek', flag: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { value: 'groq', label: 'Groq', flag: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { value: 'ollama', label: 'Ollama', flag: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama' },
  { value: 'lmstudio', label: 'LM Studio', flag: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-studio' },
  { value: 'anthropic', label: 'Anthropic', flag: 'anthropic' },
  { value: 'gemini', label: 'Google Gemini', flag: 'gemini' },
  { value: 'mistral', label: 'Mistral', flag: 'mistral' },
  { value: 'github', label: 'GitHub Models', flag: 'github' },
]

const DEFAULT_CONFIG = {
  api: {
    enabled: true,
    host: '127.0.0.1',
    port: 8642,
    apiKey: '',
    modelName: 'openclaude-agent',
    corsOrigins: ['http://localhost:8080'],
  },
  cron: {
    enabled: true,
    tickIntervalSeconds: 60,
  },
  telegram: {
    enabled: false,
    botToken: '',
    allowedChatIds: [],
    allowedUserIds: [],
    homeChatId: '',
    mirrorAgentApiResponses: true,
    downloadFiles: true,
    maxDownloadBytes: 20 * 1024 * 1024,
    maxUploadBytes: 50 * 1024 * 1024,
    transcribeAudio: true,
    transcriptionProvider: 'auto',
    transcriptionWhisperModel: 'base',
    transcriptionOpenAIModel: 'whisper-1',
    transcriptionTimeoutMs: 120000,
    replyWithTranscript: true,
  },
  ouroboros: {
    enabled: false,
    consciousnessEnabled: false,
    wakeupMinSeconds: 300,
    wakeupMaxSeconds: 7200,
    maxRounds: 3,
    budgetFraction: 0.1,
    infiniteTasksEnabled: false,
  },
  openWebUI: {
    host: 'localhost',
    port: 8080,
    pythonCommand: process.platform === 'win32' ? 'py -3.11' : 'python3.11',
    dataDir: OPENWEBUI_DATA_DIR,
  },
  openRAG: {
    enabled: false,
    url: 'http://localhost:3000',
    apiKey: '',
    repoDir: OPENRAG_REPO_DIR,
    workspaceDir: OPENRAG_WORKSPACE_DIR,
    frontendPort: 3000,
    langflowPort: 7860,
    doclingPort: 5001,
    openSearchPassword: '',
    langflowSuperuser: 'admin',
    langflowSuperuserPassword: '',
    llmProvider: 'openai',
    llmModel: '',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    ollamaEndpoint: 'http://host.docker.internal:11434',
    mcpEnabled: false,
    mcpCommand: 'node',
    mcpArgs: [OPENRAG_MCP_BRIDGE_ARG],
    mcpTimeoutSeconds: 60,
    useAgentProvider: true,
  },
  camofox: {
    enabled: true,
    url: 'http://localhost:9377',
    port: 9377,
    accessKey: '',
    apiKey: '',
    userId: 'openclaude-agent',
    sessionKey: 'default',
    mcpEnabled: true,
    mcpTimeoutSeconds: 60,
  },
  hindsight: {
    enabled: true,
    url: 'http://localhost:8888',
    apiKey: '',
    bankId: 'openclaude-agent',
    apiPort: 8888,
    uiPort: 9999,
    mcpEnabled: true,
    mcpTimeoutSeconds: 60,
    useAgentProvider: true,
    llmProvider: 'openai',
    llmModel: '',
    llmBaseUrl: '',
    llmApiKey: '',
  },
  ui: {
    language: 'ru',
  },
  runner: {
    cwd: ROOT_DIR,
    maxTurns: 24,
    timeoutMs: 600000,
    permissionMode: 'bypassPermissions',
    availableTools: [],
    disallowedTools: [],
  },
  docker: {
    apiHostPort: 18642,
    openWebUIHostPort: 28080,
    projectName: 'openclaude-agent',
    provider: {
      useMainProvider: true,
      provider: 'openai-compatible',
      baseUrl: '',
      model: '',
      apiKey: '',
    },
    telegram: {
      enabled: false,
      useMainTelegram: false,
      botToken: '',
      allowedChatIds: [],
      allowedUserIds: [],
      homeChatId: '',
    },
  },
}

const managedProcesses = new Map()

await mkdir(STATE_DIR, { recursive: true })

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (request.method === 'GET' && url.pathname === '/') {
      return sendHtml(response)
    }
    if (request.method === 'GET' && url.pathname === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'max-age=86400' })
      return response.end()
    }
    if (url.pathname === '/api/state' && request.method === 'GET') {
      return sendJson(response, await loadState())
    }
    if (url.pathname === '/api/save' && request.method === 'POST') {
      const state = await readJson(request)
      const saved = await saveState(state)
      return sendJson(response, { ok: true, state: saved })
    }
    if (url.pathname === '/api/generate-key' && request.method === 'POST') {
      return sendJson(response, { apiKey: generateApiKey() })
    }
    if (url.pathname === '/api/provider/models' && request.method === 'POST') {
      return sendJson(response, await loadProviderModels(await readJson(request)))
    }
    if (url.pathname === '/api/start/local' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await startLocalGateway(state))
    }
    if (url.pathname === '/api/stop/local' && request.method === 'POST') {
      return sendJson(response, await stopLocalGateway())
    }
    if (url.pathname === '/api/openwebui/install' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await installOpenWebUI(state))
    }
    if (url.pathname === '/api/openwebui/start' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await startOpenWebUI(state))
    }
    if (url.pathname === '/api/openrag/install' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await installOpenRAG(state))
    }
    if (url.pathname === '/api/openrag/start-tui' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await startOpenRAGTui(state))
    }
    if (url.pathname === '/api/openrag/start-docker' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await startOpenRAGDocker(state))
    }
    if (url.pathname === '/api/openrag/stop-docker' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await stopOpenRAGDocker(state))
    }
    if (url.pathname === '/api/openrag/configure-mcp' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await configureOpenRAGMcp(state))
    }
    if (url.pathname === '/api/openrag/create-key' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await createOpenRAGApiKey(state))
    }
    if (url.pathname === '/api/openrag/test' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await testOpenRAG(state))
    }
    if (url.pathname === '/api/camofox/configure-mcp' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await configureCamofoxMcp(state))
    }
    if (url.pathname === '/api/camofox/test' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await testCamofox(state))
    }
    if (url.pathname === '/api/hindsight/start-docker' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await startHindsightDocker(state))
    }
    if (url.pathname === '/api/hindsight/stop-docker' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await stopHindsightDocker(state))
    }
    if (url.pathname === '/api/hindsight/configure-mcp' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await configureHindsightMcp(state))
    }
    if (url.pathname === '/api/hindsight/test' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await testHindsight(state))
    }
    if (url.pathname === '/api/mcp/configure-all' && request.method === 'POST') {
      const state = await readActionState(request)
      const openrag = await safeAction(() => configureOpenRAGMcp(state))
      const camofox = await safeAction(() => configureCamofoxMcp(state))
      const hindsight = await safeAction(() => configureHindsightMcp(state))
      return sendJson(response, { ok: openrag.ok && camofox.ok && hindsight.ok, openrag, camofox, hindsight })
    }
    if (url.pathname === '/api/docker/start' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await startDocker(state))
    }
    if (url.pathname === '/api/docker/stop' && request.method === 'POST') {
      const state = await loadState()
      return sendJson(response, await stopDocker(state))
    }
    if (url.pathname === '/api/test/local' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await runLocalSmoke(state))
    }
    if (url.pathname === '/api/test/docker' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await runDockerSmoke(state))
    }
    if (url.pathname === '/api/test/all' && request.method === 'POST') {
      const state = await readActionState(request)
      return sendJson(response, await runAllSmoke(state))
    }
    if (url.pathname === '/api/status' && request.method === 'GET') {
      return sendJson(response, await getRuntimeStatus(await loadState()))
    }
    sendJson(response, { ok: false, error: 'Not found' }, 404)
  } catch (error) {
    sendJson(response, { ok: false, error: String(error?.message || error) }, 500)
  }
})

server.listen(CONTROL_PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${CONTROL_PORT}`
  console.log(`OpenClaude Control Center: ${url}`)
  if (!NO_OPEN) openBrowser(url)
})

function sendHtml(response) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(html())
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

async function readActionState(request) {
  const current = await loadState()
  const patch = await readJson(request)
  return await saveState(deepMerge(current, patch))
}

async function safeAction(action) {
  try {
    return await action()
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

async function loadState() {
  const env = await readEnvFile()
  const config = await readJsonFile(CONFIG_PATH, DEFAULT_CONFIG)
  const merged = deepMerge(DEFAULT_CONFIG, config)
  if (!merged.api.apiKey) merged.api.apiKey = env.OPENCLAUDE_AGENT_API_KEY || generateApiKey()
  if (!merged.openWebUI.dataDir) merged.openWebUI.dataDir = OPENWEBUI_DATA_DIR
  merged.openRAG = normalizeOpenRAG({
    ...DEFAULT_CONFIG.openRAG,
    ...(merged.openRAG || {}),
    enabled: envBool(env.OPENCLAUDE_OPENRAG_ENABLED, merged.openRAG?.enabled ?? DEFAULT_CONFIG.openRAG.enabled),
    url: env.OPENRAG_URL || env.OPENCLAUDE_OPENRAG_URL || merged.openRAG?.url || DEFAULT_CONFIG.openRAG.url,
    apiKey: env.OPENRAG_API_KEY || env.OPENCLAUDE_OPENRAG_API_KEY || merged.openRAG?.apiKey || '',
    repoDir: env.OPENCLAUDE_OPENRAG_REPO_DIR || merged.openRAG?.repoDir || OPENRAG_REPO_DIR,
    workspaceDir: env.OPENCLAUDE_OPENRAG_WORKSPACE_DIR || merged.openRAG?.workspaceDir || OPENRAG_WORKSPACE_DIR,
    frontendPort: toPort(env.OPENCLAUDE_OPENRAG_FRONTEND_PORT, merged.openRAG?.frontendPort || DEFAULT_CONFIG.openRAG.frontendPort),
    langflowPort: toPort(env.OPENCLAUDE_OPENRAG_LANGFLOW_PORT, merged.openRAG?.langflowPort || DEFAULT_CONFIG.openRAG.langflowPort),
    doclingPort: toPort(env.OPENCLAUDE_OPENRAG_DOCLING_PORT, merged.openRAG?.doclingPort || DEFAULT_CONFIG.openRAG.doclingPort),
    openSearchPassword: env.OPENCLAUDE_OPENRAG_OPENSEARCH_PASSWORD || merged.openRAG?.openSearchPassword || '',
    langflowSuperuser: env.OPENCLAUDE_OPENRAG_LANGFLOW_SUPERUSER || merged.openRAG?.langflowSuperuser || DEFAULT_CONFIG.openRAG.langflowSuperuser,
    langflowSuperuserPassword: env.OPENCLAUDE_OPENRAG_LANGFLOW_SUPERUSER_PASSWORD || merged.openRAG?.langflowSuperuserPassword || '',
    llmProvider: env.OPENCLAUDE_OPENRAG_LLM_PROVIDER || env.LLM_PROVIDER || merged.openRAG?.llmProvider || DEFAULT_CONFIG.openRAG.llmProvider,
    llmModel: env.OPENCLAUDE_OPENRAG_LLM_MODEL || env.LLM_MODEL || merged.openRAG?.llmModel || '',
    embeddingProvider: env.OPENCLAUDE_OPENRAG_EMBEDDING_PROVIDER || env.EMBEDDING_PROVIDER || merged.openRAG?.embeddingProvider || DEFAULT_CONFIG.openRAG.embeddingProvider,
    embeddingModel: env.OPENCLAUDE_OPENRAG_EMBEDDING_MODEL || env.EMBEDDING_MODEL || merged.openRAG?.embeddingModel || DEFAULT_CONFIG.openRAG.embeddingModel,
    ollamaEndpoint: env.OPENCLAUDE_OPENRAG_OLLAMA_ENDPOINT || env.OLLAMA_ENDPOINT || merged.openRAG?.ollamaEndpoint || DEFAULT_CONFIG.openRAG.ollamaEndpoint,
    mcpEnabled: envBool(env.OPENCLAUDE_OPENRAG_MCP_ENABLED, merged.openRAG?.mcpEnabled ?? DEFAULT_CONFIG.openRAG.mcpEnabled),
    mcpCommand: env.OPENCLAUDE_OPENRAG_MCP_COMMAND || merged.openRAG?.mcpCommand || DEFAULT_CONFIG.openRAG.mcpCommand,
    mcpArgs: env.OPENCLAUDE_OPENRAG_MCP_ARGS !== undefined ? splitList(env.OPENCLAUDE_OPENRAG_MCP_ARGS) : merged.openRAG?.mcpArgs || DEFAULT_CONFIG.openRAG.mcpArgs,
    mcpTimeoutSeconds: Number(env.OPENRAG_MCP_TIMEOUT || env.OPENCLAUDE_OPENRAG_MCP_TIMEOUT_SECONDS || merged.openRAG?.mcpTimeoutSeconds || DEFAULT_CONFIG.openRAG.mcpTimeoutSeconds),
  })
  merged.camofox = normalizeCamofox({
    ...DEFAULT_CONFIG.camofox,
    ...(merged.camofox || {}),
    enabled: envBool(env.OPENCLAUDE_CAMOFOX_ENABLED, merged.camofox?.enabled ?? DEFAULT_CONFIG.camofox.enabled),
    url: env.CAMOFOX_URL || merged.camofox?.url || DEFAULT_CONFIG.camofox.url,
    port: toPort(env.CAMOFOX_PORT, merged.camofox?.port || DEFAULT_CONFIG.camofox.port),
    accessKey: env.CAMOFOX_ACCESS_KEY || merged.camofox?.accessKey || '',
    apiKey: env.CAMOFOX_API_KEY || merged.camofox?.apiKey || '',
    userId: env.CAMOFOX_MCP_USER_ID || merged.camofox?.userId || DEFAULT_CONFIG.camofox.userId,
    sessionKey: env.CAMOFOX_MCP_SESSION_KEY || merged.camofox?.sessionKey || DEFAULT_CONFIG.camofox.sessionKey,
    mcpEnabled: envBool(env.OPENCLAUDE_CAMOFOX_MCP_ENABLED, merged.camofox?.mcpEnabled ?? DEFAULT_CONFIG.camofox.mcpEnabled),
    mcpTimeoutSeconds: Number(env.CAMOFOX_MCP_TIMEOUT || merged.camofox?.mcpTimeoutSeconds || DEFAULT_CONFIG.camofox.mcpTimeoutSeconds),
  })
  merged.hindsight = normalizeHindsight({
    ...DEFAULT_CONFIG.hindsight,
    ...(merged.hindsight || {}),
    enabled: envBool(env.OPENCLAUDE_HINDSIGHT_ENABLED, merged.hindsight?.enabled ?? DEFAULT_CONFIG.hindsight.enabled),
    url: env.HINDSIGHT_URL || merged.hindsight?.url || DEFAULT_CONFIG.hindsight.url,
    apiKey: env.HINDSIGHT_API_KEY || merged.hindsight?.apiKey || '',
    bankId: env.HINDSIGHT_BANK_ID || merged.hindsight?.bankId || DEFAULT_CONFIG.hindsight.bankId,
    apiPort: toPort(env.HINDSIGHT_API_PORT, merged.hindsight?.apiPort || DEFAULT_CONFIG.hindsight.apiPort),
    uiPort: toPort(env.HINDSIGHT_UI_PORT, merged.hindsight?.uiPort || DEFAULT_CONFIG.hindsight.uiPort),
    mcpEnabled: envBool(env.OPENCLAUDE_HINDSIGHT_MCP_ENABLED, merged.hindsight?.mcpEnabled ?? DEFAULT_CONFIG.hindsight.mcpEnabled),
    mcpTimeoutSeconds: Number(env.HINDSIGHT_MCP_TIMEOUT || merged.hindsight?.mcpTimeoutSeconds || DEFAULT_CONFIG.hindsight.mcpTimeoutSeconds),
    useAgentProvider: envBool(env.OPENCLAUDE_HINDSIGHT_USE_AGENT_PROVIDER, merged.hindsight?.useAgentProvider ?? DEFAULT_CONFIG.hindsight.useAgentProvider),
    llmProvider: env.HINDSIGHT_API_LLM_PROVIDER || merged.hindsight?.llmProvider || DEFAULT_CONFIG.hindsight.llmProvider,
    llmModel: env.HINDSIGHT_API_LLM_MODEL || merged.hindsight?.llmModel || '',
    llmBaseUrl: env.HINDSIGHT_API_LLM_BASE_URL || merged.hindsight?.llmBaseUrl || '',
    llmApiKey: env.HINDSIGHT_API_LLM_API_KEY || merged.hindsight?.llmApiKey || '',
  })
  if (!merged.runner.cwd) merged.runner.cwd = ROOT_DIR
  merged.provider = getProviderState(env)
  merged.docker = {
    ...DEFAULT_CONFIG.docker,
    ...(merged.docker || {}),
    apiHostPort: toPort(env.OPENCLAUDE_AGENT_API_HOST_PORT, DEFAULT_CONFIG.docker.apiHostPort),
    openWebUIHostPort: toPort(env.OPENCLAUDE_OPEN_WEBUI_HOST_PORT, DEFAULT_CONFIG.docker.openWebUIHostPort),
    projectName: env.OPENCLAUDE_DOCKER_PROJECT || DEFAULT_CONFIG.docker.projectName,
    provider: normalizeDockerProvider({
      ...DEFAULT_CONFIG.docker.provider,
      ...(merged.docker?.provider || {}),
      useMainProvider: envBool(env.OPENCLAUDE_DOCKER_PROVIDER_USE_MAIN, merged.docker?.provider?.useMainProvider ?? DEFAULT_CONFIG.docker.provider.useMainProvider),
      provider: env.OPENCLAUDE_DOCKER_PROVIDER || merged.docker?.provider?.provider || DEFAULT_CONFIG.docker.provider.provider,
      baseUrl: env.OPENCLAUDE_DOCKER_BASE_URL || merged.docker?.provider?.baseUrl || '',
      model: env.OPENCLAUDE_DOCKER_MODEL || merged.docker?.provider?.model || '',
      apiKey: env.OPENCLAUDE_DOCKER_API_KEY || merged.docker?.provider?.apiKey || '',
    }),
    telegram: {
      ...DEFAULT_CONFIG.docker.telegram,
      ...(merged.docker?.telegram || {}),
      enabled: envBool(env.OPENCLAUDE_DOCKER_TELEGRAM_ENABLED, merged.docker?.telegram?.enabled ?? DEFAULT_CONFIG.docker.telegram.enabled),
      useMainTelegram: envBool(env.OPENCLAUDE_DOCKER_TELEGRAM_USE_MAIN, merged.docker?.telegram?.useMainTelegram ?? DEFAULT_CONFIG.docker.telegram.useMainTelegram),
      botToken: env.OPENCLAUDE_DOCKER_TELEGRAM_BOT_TOKEN || merged.docker?.telegram?.botToken || '',
      homeChatId: env.OPENCLAUDE_DOCKER_TELEGRAM_HOME_CHAT_ID || merged.docker?.telegram?.homeChatId || '',
      allowedChatIds: env.OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_CHAT_IDS !== undefined
        ? splitList(env.OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_CHAT_IDS)
        : splitList(merged.docker?.telegram?.allowedChatIds || []),
      allowedUserIds: env.OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_USER_IDS !== undefined
        ? splitList(env.OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_USER_IDS)
        : splitList(merged.docker?.telegram?.allowedUserIds || []),
    },
  }
  return {
    rootDir: ROOT_DIR,
    configPath: CONFIG_PATH,
    envPath: ENV_PATH,
    providers: PROVIDERS,
    ...merged,
    status: await getRuntimeStatus(merged).catch(error => ({ error: String(error?.message || error) })),
  }
}

async function saveState(state) {
  const next = normalizeState(state)
  await mkdir(CONFIG_HOME, { recursive: true })
  await mkdir(path.join(CONFIG_HOME, 'agent-gateway'), { recursive: true })
  await writeFile(CONFIG_PATH, `${JSON.stringify(toAgentGatewayConfig(next), null, 2)}\n`, 'utf8')
  await updateEnvFile(toEnvUpdates(next))
  return await loadState()
}

function normalizeState(input) {
  const state = deepMerge(DEFAULT_CONFIG, input || {})
  state.api.enabled = Boolean(state.api.enabled)
  state.api.host = String(state.api.host || '127.0.0.1')
  state.api.port = toPort(state.api.port, 8642)
  state.api.apiKey = String(state.api.apiKey || '').trim() || generateApiKey()
  state.api.modelName = String(state.api.modelName || 'openclaude-agent').trim()
  state.api.corsOrigins = splitList(state.api.corsOrigins)
  state.cron.enabled = state.cron.enabled !== false
  state.cron.tickIntervalSeconds = Math.max(1, Number(state.cron.tickIntervalSeconds || 60))
  state.telegram.enabled = Boolean(state.telegram.enabled)
  state.telegram.botToken = String(state.telegram.botToken || '').trim()
  state.telegram.allowedChatIds = splitList(state.telegram.allowedChatIds)
  state.telegram.allowedUserIds = splitList(state.telegram.allowedUserIds)
  state.telegram.homeChatId = String(state.telegram.homeChatId || '').trim()
  state.telegram.mirrorAgentApiResponses = state.telegram.mirrorAgentApiResponses !== false
  state.telegram.downloadFiles = state.telegram.downloadFiles !== false
  state.telegram.maxDownloadBytes = Math.max(1_000_000, Number(state.telegram.maxDownloadBytes || DEFAULT_CONFIG.telegram.maxDownloadBytes))
  state.telegram.maxUploadBytes = Math.max(1_000_000, Number(state.telegram.maxUploadBytes || DEFAULT_CONFIG.telegram.maxUploadBytes))
  state.telegram.transcribeAudio = state.telegram.transcribeAudio !== false
  state.telegram.transcriptionProvider = ['auto', 'whisper', 'parakeet', 'openai'].includes(state.telegram.transcriptionProvider) ? state.telegram.transcriptionProvider : 'auto'
  state.telegram.transcriptionWhisperModel = String(state.telegram.transcriptionWhisperModel || DEFAULT_CONFIG.telegram.transcriptionWhisperModel).trim()
  state.telegram.transcriptionOpenAIModel = String(state.telegram.transcriptionOpenAIModel || DEFAULT_CONFIG.telegram.transcriptionOpenAIModel).trim()
  state.telegram.replyWithTranscript = state.telegram.replyWithTranscript !== false
  state.ouroboros.enabled = Boolean(state.ouroboros.enabled)
  state.ouroboros.consciousnessEnabled = Boolean(state.ouroboros.consciousnessEnabled)
  state.ouroboros.infiniteTasksEnabled = Boolean(state.ouroboros.infiniteTasksEnabled)
  state.ouroboros.wakeupMinSeconds = Math.max(30, Number(state.ouroboros.wakeupMinSeconds || 300))
  state.ouroboros.wakeupMaxSeconds = Math.max(60, Number(state.ouroboros.wakeupMaxSeconds || 7200))
  state.ouroboros.maxRounds = Math.max(1, Number(state.ouroboros.maxRounds || 3))
  state.ouroboros.budgetFraction = clamp(Number(state.ouroboros.budgetFraction ?? 0.1), 0, 1)
  state.openWebUI.host = String(state.openWebUI.host || 'localhost').trim()
  state.openWebUI.port = toPort(state.openWebUI.port, 8080)
  state.openWebUI.pythonCommand = String(state.openWebUI.pythonCommand || DEFAULT_CONFIG.openWebUI.pythonCommand).trim()
  state.openWebUI.dataDir = String(state.openWebUI.dataDir || OPENWEBUI_DATA_DIR).trim()
  state.openRAG = normalizeOpenRAG(state.openRAG || {})
  state.camofox = normalizeCamofox(state.camofox || {})
  state.hindsight = normalizeHindsight(state.hindsight || {})
  state.runner.cwd = String(state.runner.cwd || ROOT_DIR).trim()
  state.runner.maxTurns = Math.max(1, Number(state.runner.maxTurns || 24))
  state.runner.timeoutMs = Math.max(1000, Number(state.runner.timeoutMs || 600000))
  state.runner.permissionMode = state.runner.permissionMode === 'bypassPermissions' ? 'bypassPermissions' : state.runner.permissionMode === 'acceptEdits' ? 'acceptEdits' : 'default'
  state.runner.availableTools = splitList(state.runner.availableTools || state.runner.tools)
  state.runner.disallowedTools = splitList(state.runner.disallowedTools)
  state.provider = normalizeProvider(state.provider || {})
  state.ui = {
    language: state.ui?.language === 'en' ? 'en' : 'ru',
  }
  state.docker.apiHostPort = toPort(state.docker.apiHostPort, 18642)
  state.docker.openWebUIHostPort = toPort(state.docker.openWebUIHostPort, 28080)
  state.docker.projectName = String(state.docker.projectName || 'openclaude-agent').trim()
  state.docker.provider = normalizeDockerProvider(state.docker.provider || {})
  state.docker.telegram = normalizeDockerTelegram(state.docker.telegram || {})
  return state
}

function toAgentGatewayConfig(state) {
  return {
    api: state.api,
    cron: state.cron,
    telegram: state.telegram,
    ouroboros: state.ouroboros,
    openWebUI: state.openWebUI,
    openRAG: state.openRAG,
    ui: state.ui || { language: 'ru' },
    runner: state.runner,
  }
}

function toEnvUpdates(state) {
  const updates = {
    OPENCLAUDE_RESPECT_PROVIDER_ENV: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONLEGACYWINDOWSSTDIO: '0',
    NO_COLOR: '1',
    RICH_NO_COLOR: '1',
    FORCE_COLOR: '0',
    TERM: 'dumb',
    OPENCLAUDE_AGENT_API_ENABLED: state.api.enabled ? '1' : '0',
    OPENCLAUDE_AGENT_API_HOST: state.api.host,
    OPENCLAUDE_AGENT_API_PORT: String(state.api.port),
    OPENCLAUDE_AGENT_API_KEY: state.api.apiKey,
    OPENCLAUDE_AGENT_API_MODEL: state.api.modelName,
    OPENCLAUDE_AGENT_API_CORS_ORIGINS: state.api.corsOrigins.join(','),
    OPENCLAUDE_AGENT_CRON_ENABLED: state.cron.enabled ? '1' : '0',
    OPENCLAUDE_AGENT_CRON_TICK_SECONDS: String(state.cron.tickIntervalSeconds),
    OPENCLAUDE_TELEGRAM_ENABLED: state.telegram.enabled ? '1' : '0',
    TELEGRAM_BOT_TOKEN: state.telegram.botToken,
    OPENCLAUDE_TELEGRAM_HOME_CHAT_ID: state.telegram.homeChatId,
    OPENCLAUDE_TELEGRAM_ALLOWED_CHAT_IDS: state.telegram.allowedChatIds.join(','),
    OPENCLAUDE_TELEGRAM_ALLOWED_USER_IDS: state.telegram.allowedUserIds.join(','),
    OPENCLAUDE_TELEGRAM_MAX_DOWNLOAD_BYTES: String(state.telegram.maxDownloadBytes),
    OPENCLAUDE_TELEGRAM_MAX_UPLOAD_BYTES: String(state.telegram.maxUploadBytes),
    OPENCLAUDE_TELEGRAM_TRANSCRIBE_AUDIO: state.telegram.transcribeAudio ? '1' : '0',
    OPENCLAUDE_TELEGRAM_TRANSCRIPTION_PROVIDER: state.telegram.transcriptionProvider,
    OPENCLAUDE_TELEGRAM_TRANSCRIPTION_WHISPER_MODEL: state.telegram.transcriptionWhisperModel,
    OPENCLAUDE_TELEGRAM_TRANSCRIPTION_OPENAI_MODEL: state.telegram.transcriptionOpenAIModel,
    OPENCLAUDE_OUROBOROS_ENABLED: state.ouroboros.enabled ? '1' : '0',
    OPENCLAUDE_CONSCIOUSNESS_ENABLED: state.ouroboros.consciousnessEnabled ? '1' : '0',
    OPENCLAUDE_INFINITE_TASKS_ENABLED: state.ouroboros.infiniteTasksEnabled ? '1' : '0',
    OPENCLAUDE_OUROBOROS_WAKEUP_MIN_SECONDS: String(state.ouroboros.wakeupMinSeconds),
    OPENCLAUDE_OUROBOROS_WAKEUP_MAX_SECONDS: String(state.ouroboros.wakeupMaxSeconds),
    OPENCLAUDE_OUROBOROS_MAX_ROUNDS: String(state.ouroboros.maxRounds),
    OPENCLAUDE_OUROBOROS_BUDGET_FRACTION: String(state.ouroboros.budgetFraction),
    OPENCLAUDE_OPEN_WEBUI_HOST: state.openWebUI.host,
    OPENCLAUDE_OPEN_WEBUI_PORT: String(state.openWebUI.port),
    OPENCLAUDE_OPEN_WEBUI_PYTHON: state.openWebUI.pythonCommand,
    OPENCLAUDE_OPEN_WEBUI_DATA_DIR: state.openWebUI.dataDir,
    OPENCLAUDE_OPENRAG_ENABLED: state.openRAG.enabled ? '1' : '0',
    OPENRAG_URL: state.openRAG.url,
    OPENCLAUDE_DOCKER_OPENRAG_URL: dockerOpenRAGUrl(state),
    OPENCLAUDE_OPENRAG_URL: state.openRAG.url,
    OPENRAG_API_KEY: state.openRAG.apiKey,
    OPENCLAUDE_OPENRAG_API_KEY: state.openRAG.apiKey,
    OPENCLAUDE_OPENRAG_REPO_DIR: state.openRAG.repoDir,
    OPENCLAUDE_OPENRAG_WORKSPACE_DIR: state.openRAG.workspaceDir,
    OPENCLAUDE_OPENRAG_FRONTEND_PORT: String(state.openRAG.frontendPort),
    OPENCLAUDE_OPENRAG_LANGFLOW_PORT: String(state.openRAG.langflowPort),
    OPENCLAUDE_OPENRAG_DOCLING_PORT: String(state.openRAG.doclingPort),
    OPENCLAUDE_OPENRAG_OPENSEARCH_PASSWORD: state.openRAG.openSearchPassword,
    OPENCLAUDE_OPENRAG_LANGFLOW_SUPERUSER: state.openRAG.langflowSuperuser,
    OPENCLAUDE_OPENRAG_LANGFLOW_SUPERUSER_PASSWORD: state.openRAG.langflowSuperuserPassword,
    OPENCLAUDE_OPENRAG_LLM_PROVIDER: state.openRAG.llmProvider,
    OPENCLAUDE_OPENRAG_LLM_MODEL: state.openRAG.llmModel,
    OPENCLAUDE_OPENRAG_EMBEDDING_PROVIDER: state.openRAG.embeddingProvider,
    OPENCLAUDE_OPENRAG_EMBEDDING_MODEL: state.openRAG.embeddingModel,
    OPENCLAUDE_OPENRAG_OLLAMA_ENDPOINT: state.openRAG.ollamaEndpoint,
    OPENCLAUDE_OPENRAG_MCP_ENABLED: state.openRAG.mcpEnabled ? '1' : '0',
    OPENCLAUDE_OPENRAG_MCP_COMMAND: state.openRAG.mcpCommand,
    OPENCLAUDE_OPENRAG_MCP_ARGS: state.openRAG.mcpArgs.join(','),
    OPENRAG_MCP_TIMEOUT: String(state.openRAG.mcpTimeoutSeconds),
    OPENCLAUDE_OPENRAG_MCP_TIMEOUT_SECONDS: String(state.openRAG.mcpTimeoutSeconds),
    OPENCLAUDE_CAMOFOX_ENABLED: state.camofox.enabled ? '1' : '0',
    OPENCLAUDE_CAMOFOX_MCP_ENABLED: state.camofox.mcpEnabled ? '1' : '0',
    CAMOFOX_URL: state.camofox.url,
    CAMOFOX_PORT: String(state.camofox.port),
    CAMOFOX_ACCESS_KEY: state.camofox.accessKey,
    CAMOFOX_API_KEY: state.camofox.apiKey,
    CAMOFOX_MCP_USER_ID: state.camofox.userId,
    CAMOFOX_MCP_SESSION_KEY: state.camofox.sessionKey,
    CAMOFOX_MCP_TIMEOUT: String(state.camofox.mcpTimeoutSeconds),
    OPENCLAUDE_DOCKER_CAMOFOX_URL: dockerCamofoxUrl(state),
    OPENCLAUDE_HINDSIGHT_ENABLED: state.hindsight.enabled ? '1' : '0',
    OPENCLAUDE_HINDSIGHT_MCP_ENABLED: state.hindsight.mcpEnabled ? '1' : '0',
    HINDSIGHT_URL: state.hindsight.url,
    HINDSIGHT_API_KEY: state.hindsight.apiKey,
    HINDSIGHT_BANK_ID: state.hindsight.bankId,
    HINDSIGHT_API_PORT: String(state.hindsight.apiPort),
    HINDSIGHT_UI_PORT: String(state.hindsight.uiPort),
    HINDSIGHT_MCP_TIMEOUT: String(state.hindsight.mcpTimeoutSeconds),
    OPENCLAUDE_HINDSIGHT_USE_AGENT_PROVIDER: state.hindsight.useAgentProvider ? '1' : '0',
    HINDSIGHT_API_LLM_PROVIDER: state.hindsight.llmProvider,
    HINDSIGHT_API_LLM_MODEL: state.hindsight.llmModel,
    HINDSIGHT_API_LLM_BASE_URL: state.hindsight.llmBaseUrl,
    HINDSIGHT_API_LLM_API_KEY: state.hindsight.llmApiKey,
    OPENCLAUDE_DOCKER_HINDSIGHT_URL: dockerHindsightUrl(state),
    OPENCLAUDE_AGENT_UI_LANGUAGE: state.ui.language,
    OPEN_WEBUI_AUTH: 'False',
    WEBUI_AUTH: 'False',
    OPENCLAUDE_AGENT_RUNNER_CWD: state.runner.cwd,
    OPENCLAUDE_AGENT_RUNNER_MAX_TURNS: String(state.runner.maxTurns),
    OPENCLAUDE_AGENT_RUNNER_TIMEOUT_MS: String(state.runner.timeoutMs),
    OPENCLAUDE_AGENT_RUNNER_PERMISSION_MODE: state.runner.permissionMode,
    OPENCLAUDE_AGENT_RUNNER_TOOLS: state.runner.availableTools.join(','),
    OPENCLAUDE_AGENT_RUNNER_DISALLOWED_TOOLS: state.runner.disallowedTools.join(','),
    OPENCLAUDE_AGENT_API_HOST_PORT: String(state.docker.apiHostPort),
    OPENCLAUDE_OPEN_WEBUI_HOST_PORT: String(state.docker.openWebUIHostPort),
    OPENCLAUDE_DOCKER_PROJECT: state.docker.projectName,
    OPENCLAUDE_DOCKER_RUNNER_CWD: '/workspace',
    OPENCLAUDE_DOCKER_PROVIDER_USE_MAIN: state.docker.provider.useMainProvider ? '1' : '0',
    OPENCLAUDE_DOCKER_PROVIDER: state.docker.provider.provider,
    OPENCLAUDE_DOCKER_BASE_URL: state.docker.provider.baseUrl,
    OPENCLAUDE_DOCKER_MODEL: state.docker.provider.model,
    OPENCLAUDE_DOCKER_API_KEY: state.docker.provider.apiKey,
    OPENCLAUDE_DOCKER_TELEGRAM_ENABLED: state.docker.telegram.enabled ? '1' : '0',
    OPENCLAUDE_DOCKER_TELEGRAM_USE_MAIN: state.docker.telegram.useMainTelegram ? '1' : '0',
    OPENCLAUDE_DOCKER_TELEGRAM_BOT_TOKEN: state.docker.telegram.botToken,
    OPENCLAUDE_DOCKER_TELEGRAM_HOME_CHAT_ID: state.docker.telegram.homeChatId,
    OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_CHAT_IDS: state.docker.telegram.allowedChatIds.join(','),
    OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_USER_IDS: state.docker.telegram.allowedUserIds.join(','),
    OPENCLAUDE_PROVIDER: state.provider.provider,
    OPENCLAUDE_BASE_URL: state.provider.baseUrl,
    OPENCLAUDE_MODEL: state.provider.model,
    OPENCLAUDE_API_KEY: state.provider.apiKey,
    CLAUDE_CODE_USE_OPENAI: '',
    CLAUDE_CODE_USE_GEMINI: '',
    CLAUDE_CODE_USE_MISTRAL: '',
    CLAUDE_CODE_USE_GITHUB: '',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_MODEL: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_BASE_URL: '',
    GEMINI_MODEL: '',
    GEMINI_API_KEY: '',
    MISTRAL_BASE_URL: '',
    MISTRAL_MODEL: '',
    MISTRAL_API_KEY: '',
  }
  const provider = getProviderInfo(state.provider.provider)
  if (provider.flag === 'openai') {
    updates.CLAUDE_CODE_USE_OPENAI = '1'
    updates.OPENAI_BASE_URL = state.provider.baseUrl
    updates.OPENAI_MODEL = state.provider.model
    updates.OPENAI_API_KEY = state.provider.apiKey
  } else if (provider.flag === 'anthropic') {
    updates.ANTHROPIC_BASE_URL = state.provider.baseUrl
    updates.ANTHROPIC_MODEL = state.provider.model
    updates.ANTHROPIC_API_KEY = state.provider.apiKey
  } else if (provider.flag === 'gemini') {
    updates.CLAUDE_CODE_USE_GEMINI = '1'
    updates.GEMINI_BASE_URL = state.provider.baseUrl
    updates.GEMINI_MODEL = state.provider.model
    updates.GEMINI_API_KEY = state.provider.apiKey
  } else if (provider.flag === 'mistral') {
    updates.CLAUDE_CODE_USE_MISTRAL = '1'
    updates.MISTRAL_BASE_URL = state.provider.baseUrl
    updates.MISTRAL_MODEL = state.provider.model
    updates.MISTRAL_API_KEY = state.provider.apiKey
  } else if (provider.flag === 'github') {
    updates.CLAUDE_CODE_USE_GITHUB = '1'
    updates.OPENAI_MODEL = state.provider.model
  }
  if (state.hindsight.useAgentProvider) {
    const hProvider = getProviderInfo(state.provider.provider)
    updates.HINDSIGHT_API_LLM_PROVIDER = hProvider.flag === 'anthropic'
      ? 'anthropic'
      : hProvider.flag === 'gemini'
        ? 'gemini'
        : hProvider.flag === 'mistral'
          ? 'openai'
          : 'openai'
    updates.HINDSIGHT_API_LLM_MODEL = state.hindsight.llmModel || state.provider.model
    updates.HINDSIGHT_API_LLM_BASE_URL = state.hindsight.llmBaseUrl || state.provider.baseUrl
    updates.HINDSIGHT_API_LLM_API_KEY = state.hindsight.llmApiKey || state.provider.apiKey
  }
  return updates
}

function normalizeProvider(input) {
  const provider = String(input.provider || 'openai-compatible')
  const info = getProviderInfo(provider)
  return {
    provider,
    baseUrl: String(input.baseUrl || info.baseUrl || '').trim(),
    model: String(input.model || '').trim(),
    apiKey: String(input.apiKey || info.apiKey || '').trim(),
  }
}

function normalizeDockerTelegram(input) {
  return {
    enabled: Boolean(input.enabled),
    useMainTelegram: Boolean(input.useMainTelegram),
    botToken: String(input.botToken || '').trim(),
    homeChatId: String(input.homeChatId || '').trim(),
    allowedChatIds: splitList(input.allowedChatIds),
    allowedUserIds: splitList(input.allowedUserIds),
  }
}

function normalizeDockerProvider(input) {
  return {
    useMainProvider: input.useMainProvider !== false,
    ...normalizeProvider(input),
  }
}

function normalizeOpenRAG(input) {
  const frontendPort = toPort(input.frontendPort, DEFAULT_CONFIG.openRAG.frontendPort)
  const url = String(input.url || `http://localhost:${frontendPort}`).trim().replace(/\/+$/, '')
  const mcpArgs = splitList(input.mcpArgs)
  return {
    enabled: Boolean(input.enabled),
    url: url || DEFAULT_CONFIG.openRAG.url,
    apiKey: String(input.apiKey || '').trim(),
    repoDir: String(input.repoDir || OPENRAG_REPO_DIR).trim(),
    workspaceDir: String(input.workspaceDir || OPENRAG_WORKSPACE_DIR).trim(),
    frontendPort,
    langflowPort: toPort(input.langflowPort, DEFAULT_CONFIG.openRAG.langflowPort),
    doclingPort: toPort(input.doclingPort, DEFAULT_CONFIG.openRAG.doclingPort),
    openSearchPassword: String(input.openSearchPassword || '').trim(),
    langflowSuperuser: String(input.langflowSuperuser || DEFAULT_CONFIG.openRAG.langflowSuperuser).trim(),
    langflowSuperuserPassword: String(input.langflowSuperuserPassword || '').trim(),
    llmProvider: normalizeOpenRAGProvider(input.llmProvider, 'llm'),
    llmModel: String(input.llmModel || '').trim(),
    embeddingProvider: normalizeOpenRAGProvider(input.embeddingProvider, 'embedding'),
    embeddingModel: String(input.embeddingModel || DEFAULT_CONFIG.openRAG.embeddingModel).trim(),
    ollamaEndpoint: String(input.ollamaEndpoint || DEFAULT_CONFIG.openRAG.ollamaEndpoint).trim(),
    mcpEnabled: Boolean(input.mcpEnabled),
    mcpCommand: String(input.mcpCommand || DEFAULT_CONFIG.openRAG.mcpCommand).trim(),
    mcpArgs: mcpArgs.length > 0 ? mcpArgs : DEFAULT_CONFIG.openRAG.mcpArgs,
    mcpTimeoutSeconds: Math.max(1, Number(input.mcpTimeoutSeconds || DEFAULT_CONFIG.openRAG.mcpTimeoutSeconds)),
    useAgentProvider: input.useAgentProvider !== false,
  }
}

function normalizeOpenRAGProvider(value, kind) {
  const allowed = kind === 'embedding'
    ? ['openai', 'watsonx', 'ollama']
    : ['openai', 'anthropic', 'watsonx', 'ollama']
  const normalized = String(value || '').trim().toLowerCase()
  return allowed.includes(normalized)
    ? normalized
    : kind === 'embedding'
      ? DEFAULT_CONFIG.openRAG.embeddingProvider
      : DEFAULT_CONFIG.openRAG.llmProvider
}

function normalizeCamofox(input) {
  const port = toPort(input.port, DEFAULT_CONFIG.camofox.port)
  const url = String(input.url || `http://localhost:${port}`).trim().replace(/\/+$/, '')
  return {
    enabled: input.enabled !== false,
    url: url || DEFAULT_CONFIG.camofox.url,
    port,
    accessKey: String(input.accessKey || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    userId: String(input.userId || DEFAULT_CONFIG.camofox.userId).trim(),
    sessionKey: String(input.sessionKey || DEFAULT_CONFIG.camofox.sessionKey).trim(),
    mcpEnabled: input.mcpEnabled !== false,
    mcpTimeoutSeconds: Math.max(1, Number(input.mcpTimeoutSeconds || DEFAULT_CONFIG.camofox.mcpTimeoutSeconds)),
  }
}

function normalizeHindsight(input) {
  const apiPort = toPort(input.apiPort, DEFAULT_CONFIG.hindsight.apiPort)
  const uiPort = toPort(input.uiPort, DEFAULT_CONFIG.hindsight.uiPort)
  const url = String(input.url || `http://localhost:${apiPort}`).trim().replace(/\/+$/, '')
  return {
    enabled: input.enabled !== false,
    url: url || DEFAULT_CONFIG.hindsight.url,
    apiKey: String(input.apiKey || '').trim(),
    bankId: String(input.bankId || DEFAULT_CONFIG.hindsight.bankId).trim(),
    apiPort,
    uiPort,
    mcpEnabled: input.mcpEnabled !== false,
    mcpTimeoutSeconds: Math.max(1, Number(input.mcpTimeoutSeconds || DEFAULT_CONFIG.hindsight.mcpTimeoutSeconds)),
    useAgentProvider: input.useAgentProvider !== false,
    llmProvider: String(input.llmProvider || DEFAULT_CONFIG.hindsight.llmProvider).trim(),
    llmModel: String(input.llmModel || '').trim(),
    llmBaseUrl: String(input.llmBaseUrl || '').trim(),
    llmApiKey: String(input.llmApiKey || '').trim(),
  }
}

function getProviderState(env) {
  let provider = env.OPENCLAUDE_PROVIDER || ''
  if (!provider) {
    if (env.CLAUDE_CODE_USE_GEMINI) provider = 'gemini'
    else if (env.CLAUDE_CODE_USE_MISTRAL) provider = 'mistral'
    else if (env.CLAUDE_CODE_USE_GITHUB) provider = 'github'
    else if (env.ANTHROPIC_API_KEY) provider = 'anthropic'
    else provider = 'openai-compatible'
  }
  const info = getProviderInfo(provider)
  const isOpenAI = info.flag === 'openai'
  return {
    provider,
    baseUrl: env.OPENCLAUDE_BASE_URL || (isOpenAI ? env.OPENAI_BASE_URL : env[`${info.flag?.toUpperCase()}_BASE_URL`]) || info.baseUrl || '',
    model: env.OPENCLAUDE_MODEL || (isOpenAI ? env.OPENAI_MODEL : env[`${info.flag?.toUpperCase()}_MODEL`]) || '',
    apiKey: env.OPENCLAUDE_API_KEY || (isOpenAI ? env.OPENAI_API_KEY : env[`${info.flag?.toUpperCase()}_API_KEY`]) || info.apiKey || '',
  }
}

function getProviderInfo(provider) {
  return PROVIDERS.find(item => item.value === provider) || PROVIDERS[0]
}

async function startLocalGateway(state) {
  await ensureBuild()
  if (await isHttpOk(`http://${loopbackHost(state.api.host)}:${state.api.port}/health`)) {
    return { ok: true, message: `Agent API already running on ${agentBaseUrl(state)}` }
  }
  const logs = logFiles('agent-gateway')
  const env = runtimeEnv(state, {
    OPENCLAUDE_AGENT_GATEWAY_SERVER: '1',
    OPENCLAUDE_AGENT_API_ENABLED: '1',
    OPENCLAUDE_AGENT_CRON_ENABLED: state.cron.enabled ? '1' : '0',
    OPENCLAUDE_RESPECT_PROVIDER_ENV: '1',
    NO_COLOR: '1',
  })
  const child = spawn(process.execPath, ['dist/cli.mjs', '--agent-gateway-server'], {
    cwd: ROOT_DIR,
    env,
    detached: true,
    stdio: ['ignore', logs.out, logs.err],
    windowsHide: false,
  })
  child.unref()
  managedProcesses.set('agent-gateway', child.pid)
  await waitForUrl(`http://${loopbackHost(state.api.host)}:${state.api.port}/health`, 30000)
  return { ok: true, pid: child.pid, url: agentBaseUrl(state), logs: logs.paths }
}

async function stopLocalGateway() {
  const ports = [Number((await loadState()).api.port)]
  const stopped = await stopProcessesByPorts(ports)
  return { ok: true, stopped }
}

async function installOpenWebUI(state) {
  const parsed = parseCommand(state.openWebUI.pythonCommand)
  const result = await runCommand(parsed.command, [...parsed.args, '-m', 'pip', 'install', 'open-webui'], {
    cwd: ROOT_DIR,
    env: runtimeEnv(state),
    timeoutMs: 10 * 60 * 1000,
  })
  return { ok: result.code === 0, ...result }
}

async function startOpenWebUI(state) {
  await mkdir(state.openWebUI.dataDir, { recursive: true })
  const url = openWebUIUrl(state)
  if (await isHttpOk(url)) return { ok: true, message: `Open WebUI already running on ${url}`, url }
  const logs = logFiles('open-webui')
  const env = runtimeEnv(state, {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    LANG: process.env.LANG || 'C.UTF-8',
    DATA_DIR: state.openWebUI.dataDir,
    WEBUI_AUTH: 'False',
    OPEN_WEBUI_AUTH: 'False',
    OPENAI_API_BASE_URLS: agentBaseUrl(state),
    OPENAI_API_KEYS: state.api.apiKey || 'openclaude-local',
  })
  const child = spawn('open-webui', ['serve', '--host', state.openWebUI.host, '--port', String(state.openWebUI.port)], {
    cwd: ROOT_DIR,
    env,
    detached: true,
    shell: process.platform === 'win32',
    stdio: ['ignore', logs.out, logs.err],
    windowsHide: false,
  })
  child.unref()
  managedProcesses.set('open-webui', child.pid)
  await waitForUrl(url, 120000)
  return { ok: true, pid: child.pid, url, logs: logs.paths }
}

async function installOpenRAG(state) {
  const steps = []
  await pushStep(steps, 'uv available', ensureUvAvailable)
  await pushStep(steps, 'clone/update OpenRAG repo', () => ensureOpenRAGRepo(state))
  if (steps.every(step => step.ok)) {
    await pushStep(steps, 'sync OpenRAG dependencies', () => runCheckedCommand('uv', ['sync', '--python', '3.13'], {
      cwd: state.openRAG.repoDir,
      env: runtimeEnv(state),
      timeoutMs: 20 * 60 * 1000,
    }))
  }
  if (steps.every(step => step.ok)) {
    await pushStep(steps, 'check OpenRAG MCP package', () => runCheckedCommand('uv', ['run', '--with', 'openrag-mcp', 'python', '-c', 'import openrag_mcp; print("OPENRAG_MCP_IMPORT_OK")'], {
      cwd: ROOT_DIR,
      env: runtimeEnv(state, openRAGRuntimeEnv(state)),
      timeoutMs: 5 * 60 * 1000,
    }))
  }
  return { ok: steps.every(step => step.ok), steps, repoDir: state.openRAG.repoDir }
}

async function startOpenRAGTui(state) {
  await mkdir(state.openRAG.workspaceDir, { recursive: true })
  const command = releaseScript('start-openrag.bat')
  const shellCommand = process.platform === 'win32'
    ? `"${command}"`
    : `"${releaseScript('start-openrag.sh')}"`
  const opened = await openInteractiveTerminal(shellCommand, ROOT_DIR, 'OpenRAG')
  return {
    ok: opened.ok,
    ...opened,
    message: 'OpenRAG TUI is interactive. Complete setup there, then create an OpenRAG API key in Settings > API Keys and save it here for MCP.',
  }
}

async function startOpenRAGDocker(state) {
  const steps = []
  await pushStep(steps, 'clone/update OpenRAG repo', () => ensureOpenRAGRepo(state))
  if (!steps.every(step => step.ok)) return { ok: false, steps }
  const prepared = await prepareOpenRAGEnv(state)
  await pushStep(steps, 'sync OpenRAG dependencies', () => runCheckedCommand('uv', ['sync', '--python', '3.13'], {
    cwd: state.openRAG.repoDir,
    env: runtimeEnv(state),
    timeoutMs: 20 * 60 * 1000,
  }))
  await pushStep(steps, 'start Docling native service', () => startDoclingNative(state))
  await pushStep(steps, 'start OpenRAG Docker services', () => runCheckedCommand('docker', ['compose', 'up', '-d'], {
    cwd: state.openRAG.repoDir,
    env: runtimeEnv(state, openRAGDockerEnv(state)),
    timeoutMs: 25 * 60 * 1000,
  }))
  if (steps.every(step => step.ok)) {
    await pushStep(steps, 'wait for OpenRAG frontend', () => waitForUrl(openRAGUrl(state), 180000))
  }
  return { ok: steps.every(step => step.ok), steps, url: openRAGUrl(state), envPath: prepared.envPath }
}

async function stopOpenRAGDocker(state) {
  const steps = []
  if (existsSync(path.join(state.openRAG.repoDir, 'docker-compose.yml'))) {
    await pushStep(steps, 'stop OpenRAG containers', () => runCheckedCommand('docker', ['compose', 'down'], {
      cwd: state.openRAG.repoDir,
      env: runtimeEnv(state, openRAGDockerEnv(state)),
      timeoutMs: 5 * 60 * 1000,
    }))
    await pushStep(steps, 'stop Docling native service', () => runCheckedCommand('uv', ['run', '--python', '3.13', 'python', 'scripts/docling_ctl.py', 'stop'], {
      cwd: state.openRAG.repoDir,
      env: runtimeEnv(state),
      timeoutMs: 60000,
    }))
  } else {
    pushSkippedStep(steps, 'OpenRAG repo', `${state.openRAG.repoDir} is not installed`)
  }
  return { ok: steps.every(step => step.ok), steps }
}

async function configureOpenRAGMcp(state) {
  const config = await readJsonFile(MCP_CONFIG_PATH, { mcpServers: {} })
  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object'
    ? config.mcpServers
    : {}
  if (state.openRAG.mcpEnabled) {
    if (!state.openRAG.apiKey) {
      throw new Error('OPENRAG_API_KEY is required before enabling OpenRAG MCP. Create it in OpenRAG Settings > API Keys.')
    }
    config.mcpServers.openrag = {
      command: state.openRAG.mcpCommand,
      args: state.openRAG.mcpArgs,
      env: {
        OPENRAG_URL: state.openRAG.url,
        OPENRAG_API_KEY: state.openRAG.apiKey,
        OPENRAG_MCP_TIMEOUT: String(state.openRAG.mcpTimeoutSeconds),
      },
    }
  } else {
    delete config.mcpServers.openrag
  }
  await writeFile(MCP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return {
    ok: true,
    path: MCP_CONFIG_PATH,
    enabled: state.openRAG.mcpEnabled,
    server: config.mcpServers.openrag
      ? { ...config.mcpServers.openrag, env: { ...config.mcpServers.openrag.env, OPENRAG_API_KEY: maskSecret(config.mcpServers.openrag.env.OPENRAG_API_KEY) } }
      : null,
  }
}

async function configureCamofoxMcp(state) {
  const config = await readJsonFile(MCP_CONFIG_PATH, { mcpServers: {} })
  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object'
    ? config.mcpServers
    : {}
  if (state.camofox.mcpEnabled) {
    config.mcpServers.camofox = {
      command: 'node',
      args: [CAMOFOX_MCP_BRIDGE_ARG],
      env: {
        CAMOFOX_URL: state.camofox.url,
        CAMOFOX_MCP_USER_ID: state.camofox.userId,
        CAMOFOX_MCP_SESSION_KEY: state.camofox.sessionKey,
        CAMOFOX_MCP_TIMEOUT: String(state.camofox.mcpTimeoutSeconds),
        CAMOFOX_ACCESS_KEY: state.camofox.accessKey || '${CAMOFOX_ACCESS_KEY}',
        CAMOFOX_API_KEY: state.camofox.apiKey || '${CAMOFOX_API_KEY}',
      },
    }
  } else {
    delete config.mcpServers.camofox
  }
  await writeFile(MCP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return {
    ok: true,
    path: MCP_CONFIG_PATH,
    enabled: state.camofox.mcpEnabled,
    server: config.mcpServers.camofox
      ? {
          ...config.mcpServers.camofox,
          env: {
            ...config.mcpServers.camofox.env,
            CAMOFOX_ACCESS_KEY: maskSecret(config.mcpServers.camofox.env.CAMOFOX_ACCESS_KEY),
            CAMOFOX_API_KEY: maskSecret(config.mcpServers.camofox.env.CAMOFOX_API_KEY),
          },
        }
      : null,
  }
}

async function configureHindsightMcp(state) {
  const config = await readJsonFile(MCP_CONFIG_PATH, { mcpServers: {} })
  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object'
    ? config.mcpServers
    : {}
  if (state.hindsight.mcpEnabled) {
    config.mcpServers.hindsight = {
      command: 'node',
      args: [HINDSIGHT_MCP_BRIDGE_ARG],
      env: {
        HINDSIGHT_URL: state.hindsight.url,
        HINDSIGHT_BANK_ID: state.hindsight.bankId,
        HINDSIGHT_MCP_TIMEOUT: String(state.hindsight.mcpTimeoutSeconds),
        HINDSIGHT_API_KEY: state.hindsight.apiKey || '${HINDSIGHT_API_KEY}',
      },
    }
  } else {
    delete config.mcpServers.hindsight
  }
  await writeFile(MCP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return {
    ok: true,
    path: MCP_CONFIG_PATH,
    enabled: state.hindsight.mcpEnabled,
    server: config.mcpServers.hindsight
      ? {
          ...config.mcpServers.hindsight,
          env: {
            ...config.mcpServers.hindsight.env,
            HINDSIGHT_API_KEY: maskSecret(config.mcpServers.hindsight.env.HINDSIGHT_API_KEY),
          },
        }
      : null,
  }
}

async function testCamofox(state) {
  const steps = []
  await pushStep(steps, 'Camofox MCP bridge syntax', () => runCheckedCommand('node', ['--check', CAMOFOX_MCP_BRIDGE], {
    cwd: ROOT_DIR,
    env: runtimeEnv(state, camofoxRuntimeEnv(state)),
    timeoutMs: 60000,
  }))
  if (state.camofox.enabled) {
    await pushStep(steps, 'Camofox health', () => fetchJson(`${state.camofox.url.replace(/\/+$/, '')}/health`, {
      headers: state.camofox.accessKey ? { Authorization: `Bearer ${state.camofox.accessKey}` } : undefined,
      timeoutMs: 30000,
    }))
  }
  return { ok: steps.every(step => step.ok), steps }
}

async function startHindsightDocker(state) {
  const result = await runCommand(process.execPath, [path.join(SCRIPT_DIR, 'hindsight-control.mjs'), 'docker-up'], {
    cwd: ROOT_DIR,
    env: runtimeEnv(state, hindsightRuntimeEnv(state)),
    timeoutMs: 10 * 60 * 1000,
  })
  return { ok: result.code === 0, ...result, apiUrl: state.hindsight.url, uiUrl: hindsightUiUrl(state) }
}

async function stopHindsightDocker(state) {
  const result = await runCommand(process.execPath, [path.join(SCRIPT_DIR, 'hindsight-control.mjs'), 'docker-down'], {
    cwd: ROOT_DIR,
    env: runtimeEnv(state, hindsightRuntimeEnv(state)),
    timeoutMs: 120000,
  })
  return { ok: result.code === 0, ...result }
}

async function testHindsight(state) {
  const steps = []
  await pushStep(steps, 'Hindsight MCP bridge syntax', () => runCheckedCommand('node', ['--check', HINDSIGHT_MCP_BRIDGE], {
    cwd: ROOT_DIR,
    env: runtimeEnv(state, hindsightRuntimeEnv(state)),
    timeoutMs: 60000,
  }))
  await pushStep(steps, 'Hindsight MCP mock smoke', () => runCheckedCommand('node', [path.join(SCRIPT_DIR, 'test-hindsight-mcp-bridge.cjs')], {
    cwd: ROOT_DIR,
    env: runtimeEnv(state, hindsightRuntimeEnv(state)),
    timeoutMs: 120000,
  }))
  if (state.hindsight.enabled && await isHttpOk(state.hindsight.url)) {
    await pushStep(steps, 'Hindsight live API', () => runCheckedCommand(process.execPath, [path.join(SCRIPT_DIR, 'hindsight-control.mjs'), 'test'], {
      cwd: ROOT_DIR,
      env: runtimeEnv(state, hindsightRuntimeEnv(state)),
      timeoutMs: 120000,
    }))
  } else {
    pushSkippedStep(steps, 'Hindsight live API', `${state.hindsight.url} is not running`)
  }
  return { ok: steps.every(step => step.ok), steps }
}

async function startDoclingNative(state) {
  if (await isHttpOk(doclingUrl(state))) {
    return { message: `Docling is already reachable at ${doclingUrl(state)}` }
  }
  try {
    const result = await runCheckedCommand('uv', ['run', '--python', '3.13', 'python', 'scripts/docling_ctl.py', 'start', '--port', String(state.openRAG.doclingPort)], {
      cwd: state.openRAG.repoDir,
      env: runtimeEnv(state),
      timeoutMs: 5 * 60 * 1000,
    })
    await waitForUrl(doclingUrl(state), 30000)
    return result
  } catch (error) {
    if (await isHttpOk(doclingUrl(state))) {
      return { warning: String(error?.message || error), message: `Docling is reachable at ${doclingUrl(state)} after start retry` }
    }
    throw error
  }
}

async function createOpenRAGApiKey(state) {
  const steps = []
  await pushStep(steps, 'OpenRAG frontend/backend reachable', () => waitForUrl(openRAGUrl(state), 30000))
  let keyResult
  if (steps.every(step => step.ok)) {
    await pushStep(steps, 'create OpenRAG API key', async () => {
      keyResult = await createOpenRAGApiKeyViaHttp(state)
      return {
        keyPrefix: keyResult.key_prefix || keyResult.keyPrefix || maskSecret(keyResult.api_key),
      }
    })
  }
  if (steps.every(step => step.ok) && keyResult?.api_key) {
    state.openRAG.enabled = true
    state.openRAG.mcpEnabled = true
    state.openRAG.apiKey = keyResult.api_key
    await saveState(state)
    await pushStep(steps, 'configure OpenRAG MCP', async () => {
      const result = await configureOpenRAGMcp(state)
      return {
        enabled: result.enabled,
        path: result.path,
        server: result.server,
      }
    })
  }
  return {
    ok: steps.every(step => step.ok),
    steps,
    keyPrefix: keyResult?.key_prefix || keyResult?.keyPrefix || undefined,
    configured: steps.every(step => step.ok) && Boolean(keyResult?.api_key),
  }
}

async function createOpenRAGApiKeyViaHttp(state) {
  const name = `OpenClaude ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`
  const errors = []
  for (const url of openRAGApiKeyUrls(state)) {
    try {
      const data = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        timeoutMs: 60000,
      })
      if (data.success === false) {
        throw new Error(data.error || 'OpenRAG returned success=false')
      }
      if (!data.api_key) {
        throw new Error('OpenRAG response did not include api_key')
      }
      return data
    } catch (error) {
      errors.push(`${url}: ${String(error?.message || error)}`)
    }
  }
  throw new Error(`Failed to create OpenRAG API key. ${errors.join(' | ')}`)
}

function openRAGApiKeyUrls(state) {
  const base = openRAGUrl(state).replace(/\/+$/, '')
  return [`${base}/api/keys`, `${base}/keys`]
}

async function testOpenRAG(state) {
  const steps = []
  await pushStep(steps, 'OpenRAG frontend', () => fetchText(state.openRAG.url))
  await pushStep(steps, 'Docling docs', () => fetchText(doclingUrl(state)))
  if (state.openRAG.apiKey) {
    await pushStep(steps, 'OpenRAG API key auth', () => fetchOpenRAGApiJson(state, '/api/v1/settings', '/v1/settings'))
  } else {
    pushSkippedStep(steps, 'OpenRAG API key auth', 'OPENRAG_API_KEY is not configured')
  }
  const usesBridge = state.openRAG.mcpCommand === 'node' && state.openRAG.mcpArgs.some(arg => path.resolve(arg) === OPENRAG_MCP_BRIDGE)
  if (usesBridge) {
    await pushStep(steps, 'OpenRAG MCP bridge syntax', () => runCheckedCommand('node', ['--check', OPENRAG_MCP_BRIDGE], {
      cwd: ROOT_DIR,
      env: runtimeEnv(state, openRAGRuntimeEnv(state)),
      timeoutMs: 60000,
    }))
  } else {
    await pushStep(steps, 'OpenRAG MCP package import', () => runCheckedCommand('uv', ['run', '--with', 'openrag-mcp', 'python', '-c', 'import openrag_mcp; print("OPENRAG_MCP_IMPORT_OK")'], {
      cwd: ROOT_DIR,
      env: runtimeEnv(state, openRAGRuntimeEnv(state)),
      timeoutMs: 5 * 60 * 1000,
    }))
  }
  return { ok: steps.every(step => step.ok), steps }
}

async function fetchOpenRAGApiJson(state, frontendPath, backendPath) {
  const base = openRAGUrl(state).replace(/\/+$/, '')
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': state.openRAG.apiKey,
  }
  const errors = []
  for (const pathName of [frontendPath, backendPath]) {
    try {
      return await fetchJson(`${base}${pathName}`, {
        method: 'GET',
        headers,
        timeoutMs: 60000,
      })
    } catch (error) {
      errors.push(`${pathName}: ${String(error?.message || error)}`)
    }
  }
  throw new Error(errors.join(' | '))
}

async function startDocker(state) {
  const dockerTelegram = getDockerTelegramEnv(state)
  const dockerProvider = getDockerProviderEnv(state)
  const env = runtimeEnv(state, {
    OPENCLAUDE_AGENT_API_HOST_PORT: String(state.docker.apiHostPort),
    OPENCLAUDE_OPEN_WEBUI_HOST_PORT: String(state.docker.openWebUIHostPort),
    OPENCLAUDE_AGENT_API_KEY: state.api.apiKey,
    OPENCLAUDE_AGENT_API_HOST: '0.0.0.0',
    OPENCLAUDE_AGENT_API_PORT: '8642',
    OPENCLAUDE_AGENT_CRON_ENABLED: state.cron.enabled ? '1' : '0',
    OPENCLAUDE_AGENT_RUNNER_CWD: '/workspace',
    OPENCLAUDE_DOCKER_OPENRAG_URL: dockerOpenRAGUrl(state),
    OPENRAG_API_KEY: state.openRAG.apiKey,
    OPENRAG_MCP_TIMEOUT: String(state.openRAG.mcpTimeoutSeconds),
    ...dockerProvider,
    ...dockerTelegram,
  })
  const result = await runCommand('docker', ['compose', '-p', state.docker.projectName, '-f', 'docker-compose.agent-gateway.yml', 'up', '--build', '-d', 'openclaude-agent', 'open-webui'], {
    cwd: ROOT_DIR,
    env,
    timeoutMs: 15 * 60 * 1000,
  })
  if (result.code !== 0) return { ok: false, ...result }
  await waitForUrl(`http://127.0.0.1:${state.docker.apiHostPort}/health`, 90000)
  return { ok: true, apiUrl: dockerAgentBaseUrl(state), openWebUIUrl: dockerOpenWebUIUrl(state), ...result }
}

function getDockerProviderEnv(state) {
  const source = state.docker.provider.useMainProvider
    ? state.provider
    : state.docker.provider
  return providerRuntimeEnv(source, 'OPENCLAUDE_DOCKER_')
}

function providerRuntimeEnv(providerState, dockerPrefix = '') {
  const provider = normalizeProvider(providerState)
  const env = {
    [`${dockerPrefix}PROVIDER`]: provider.provider,
    [`${dockerPrefix}BASE_URL`]: provider.baseUrl,
    [`${dockerPrefix}MODEL`]: provider.model,
    [`${dockerPrefix}API_KEY`]: provider.apiKey,
    OPENCLAUDE_PROVIDER: provider.provider,
    OPENCLAUDE_BASE_URL: provider.baseUrl,
    OPENCLAUDE_MODEL: provider.model,
    OPENCLAUDE_API_KEY: provider.apiKey,
    CLAUDE_CODE_USE_OPENAI: '',
    CLAUDE_CODE_USE_GEMINI: '',
    CLAUDE_CODE_USE_MISTRAL: '',
    CLAUDE_CODE_USE_GITHUB: '',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_MODEL: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_BASE_URL: '',
    GEMINI_MODEL: '',
    GEMINI_API_KEY: '',
    MISTRAL_BASE_URL: '',
    MISTRAL_MODEL: '',
    MISTRAL_API_KEY: '',
  }
  const info = getProviderInfo(provider.provider)
  if (info.flag === 'openai') {
    env.CLAUDE_CODE_USE_OPENAI = '1'
    env.OPENAI_BASE_URL = provider.baseUrl
    env.OPENAI_MODEL = provider.model
    env.OPENAI_API_KEY = provider.apiKey
  } else if (info.flag === 'anthropic') {
    env.ANTHROPIC_BASE_URL = provider.baseUrl
    env.ANTHROPIC_MODEL = provider.model
    env.ANTHROPIC_API_KEY = provider.apiKey
  } else if (info.flag === 'gemini') {
    env.CLAUDE_CODE_USE_GEMINI = '1'
    env.GEMINI_BASE_URL = provider.baseUrl
    env.GEMINI_MODEL = provider.model
    env.GEMINI_API_KEY = provider.apiKey
  } else if (info.flag === 'mistral') {
    env.CLAUDE_CODE_USE_MISTRAL = '1'
    env.MISTRAL_BASE_URL = provider.baseUrl
    env.MISTRAL_MODEL = provider.model
    env.MISTRAL_API_KEY = provider.apiKey
  } else if (info.flag === 'github') {
    env.CLAUDE_CODE_USE_GITHUB = '1'
    env.OPENAI_MODEL = provider.model
  }
  return env
}

function getDockerTelegramEnv(state) {
  const source = state.docker.telegram.useMainTelegram
    ? state.telegram
    : state.docker.telegram
  const enabled = Boolean(state.docker.telegram.enabled)
  return {
    OPENCLAUDE_DOCKER_TELEGRAM_ENABLED: enabled ? '1' : '0',
    OPENCLAUDE_DOCKER_TELEGRAM_BOT_TOKEN: enabled ? source.botToken || '' : '',
    OPENCLAUDE_DOCKER_TELEGRAM_HOME_CHAT_ID: enabled ? source.homeChatId || '' : '',
    OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_CHAT_IDS: enabled ? splitList(source.allowedChatIds).join(',') : '',
    OPENCLAUDE_DOCKER_TELEGRAM_ALLOWED_USER_IDS: enabled ? splitList(source.allowedUserIds).join(',') : '',
  }
}

async function ensureUvAvailable() {
  if (await commandExists('uv')) {
    return { message: 'uv is already installed' }
  }
  if (process.platform === 'win32') {
    return await runCheckedCommand('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex'], {
      cwd: ROOT_DIR,
      timeoutMs: 5 * 60 * 1000,
    })
  }
  return await runCheckedCommand('sh', ['-lc', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
    cwd: ROOT_DIR,
    timeoutMs: 5 * 60 * 1000,
  })
}

async function ensureOpenRAGRepo(state) {
  await mkdir(path.dirname(state.openRAG.repoDir), { recursive: true })
  if (existsSync(path.join(state.openRAG.repoDir, '.git'))) {
    return await runCheckedCommand('git', ['-C', state.openRAG.repoDir, 'pull', '--ff-only'], {
      cwd: ROOT_DIR,
      timeoutMs: 5 * 60 * 1000,
    })
  }
  return await runCheckedCommand('git', ['clone', '--depth', '1', 'https://github.com/langflow-ai/openrag.git', state.openRAG.repoDir], {
    cwd: ROOT_DIR,
    timeoutMs: 10 * 60 * 1000,
  })
}

async function prepareOpenRAGEnv(state) {
  state.openRAG.openSearchPassword ||= generateComplexSecret()
  state.openRAG.langflowSuperuser ||= 'admin'
  state.openRAG.langflowSuperuserPassword ||= generateComplexSecret()
  await mkdir(state.openRAG.repoDir, { recursive: true })
  await mkdir(OPENRAG_DOCUMENTS_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, `${JSON.stringify(toAgentGatewayConfig(state), null, 2)}\n`, 'utf8')
  await updateEnvFile(toEnvUpdates(state))
  const envPath = path.join(state.openRAG.repoDir, '.env')
  const existingOpenRAGEnv = existsSync(envPath) ? parseEnv(await readFile(envPath, 'utf8')) : {}
  await updateEnvFileAt(envPath, {
    OPENSEARCH_PASSWORD: state.openRAG.openSearchPassword,
    LANGFLOW_SUPERUSER: state.openRAG.langflowSuperuser,
    LANGFLOW_SUPERUSER_PASSWORD: state.openRAG.langflowSuperuserPassword,
    LANGFLOW_SECRET_KEY: process.env.LANGFLOW_SECRET_KEY || normalizeFernetKey(existingOpenRAGEnv.LANGFLOW_SECRET_KEY),
    LANGFLOW_AUTO_LOGIN: 'False',
    LANGFLOW_NEW_USER_IS_ACTIVE: 'False',
    LANGFLOW_ENABLE_SUPERUSER_CLI: 'True',
    LANGFLOW_CHAT_FLOW_ID: '1098eea1-6649-4e1d-aed1-b77249fb8dd0',
    LANGFLOW_INGEST_FLOW_ID: '5488df7c-b93f-4f87-a446-b67028bc0813',
    LANGFLOW_URL_INGEST_FLOW_ID: '72c3d17c-2dac-4a73-b48a-6518473d7830',
    DISABLE_INGEST_WITH_LANGFLOW: 'true',
    LANGFLOW_KEY: existingOpenRAGEnv.LANGFLOW_KEY || '',
    NUDGES_FLOW_ID: 'ebc01d31-1976-46ce-a385-b0240327226c',
    LLM_PROVIDER: state.openRAG.llmProvider,
    LLM_MODEL: state.openRAG.llmModel,
    EMBEDDING_PROVIDER: state.openRAG.embeddingProvider,
    EMBEDDING_MODEL: state.openRAG.embeddingModel,
    OLLAMA_ENDPOINT: state.openRAG.ollamaEndpoint,
    FRONTEND_PORT: String(state.openRAG.frontendPort),
    LANGFLOW_PORT: String(state.openRAG.langflowPort),
    LANGFLOW_PUBLIC_URL: `http://localhost:${state.openRAG.langflowPort}`,
    DOCLING_SERVE_URL: `http://host.docker.internal:${state.openRAG.doclingPort}`,
    OPENRAG_DOCUMENTS_PATH: OPENRAG_DOCUMENTS_DIR,
    OPENRAG_VERSION: 'latest',
    INGEST_SAMPLE_DATA: 'true',
    ...openRAGProviderEnv(state),
  })
  return { envPath }
}

function openRAGRuntimeEnv(state) {
  return {
    OPENRAG_URL: state.openRAG.url,
    OPENRAG_API_KEY: state.openRAG.apiKey,
    OPENRAG_MCP_TIMEOUT: String(state.openRAG.mcpTimeoutSeconds),
  }
}

function camofoxRuntimeEnv(state) {
  return {
    CAMOFOX_URL: state.camofox.url,
    CAMOFOX_PORT: String(state.camofox.port),
    CAMOFOX_ACCESS_KEY: state.camofox.accessKey,
    CAMOFOX_API_KEY: state.camofox.apiKey,
    CAMOFOX_MCP_USER_ID: state.camofox.userId,
    CAMOFOX_MCP_SESSION_KEY: state.camofox.sessionKey,
    CAMOFOX_MCP_TIMEOUT: String(state.camofox.mcpTimeoutSeconds),
  }
}

function hindsightRuntimeEnv(state) {
  return {
    HINDSIGHT_URL: state.hindsight.url,
    HINDSIGHT_API_KEY: state.hindsight.apiKey,
    HINDSIGHT_BANK_ID: state.hindsight.bankId,
    HINDSIGHT_API_PORT: String(state.hindsight.apiPort),
    HINDSIGHT_UI_PORT: String(state.hindsight.uiPort),
    HINDSIGHT_MCP_TIMEOUT: String(state.hindsight.mcpTimeoutSeconds),
    HINDSIGHT_API_LLM_PROVIDER: state.hindsight.useAgentProvider
      ? toEnvUpdates(state).HINDSIGHT_API_LLM_PROVIDER
      : state.hindsight.llmProvider,
    HINDSIGHT_API_LLM_MODEL: state.hindsight.useAgentProvider
      ? toEnvUpdates(state).HINDSIGHT_API_LLM_MODEL
      : state.hindsight.llmModel,
    HINDSIGHT_API_LLM_BASE_URL: state.hindsight.useAgentProvider
      ? toEnvUpdates(state).HINDSIGHT_API_LLM_BASE_URL
      : state.hindsight.llmBaseUrl,
    HINDSIGHT_API_LLM_API_KEY: state.hindsight.useAgentProvider
      ? toEnvUpdates(state).HINDSIGHT_API_LLM_API_KEY
      : state.hindsight.llmApiKey,
  }
}

function openRAGDockerEnv(state) {
  return {
    ...openRAGRuntimeEnv(state),
    OPENSEARCH_PASSWORD: state.openRAG.openSearchPassword,
    LANGFLOW_SUPERUSER: state.openRAG.langflowSuperuser,
    LANGFLOW_SUPERUSER_PASSWORD: state.openRAG.langflowSuperuserPassword,
    LANGFLOW_AUTO_LOGIN: 'False',
    LANGFLOW_NEW_USER_IS_ACTIVE: 'False',
    LANGFLOW_ENABLE_SUPERUSER_CLI: 'True',
    LANGFLOW_CHAT_FLOW_ID: '1098eea1-6649-4e1d-aed1-b77249fb8dd0',
    LANGFLOW_INGEST_FLOW_ID: '5488df7c-b93f-4f87-a446-b67028bc0813',
    LANGFLOW_URL_INGEST_FLOW_ID: '72c3d17c-2dac-4a73-b48a-6518473d7830',
    DISABLE_INGEST_WITH_LANGFLOW: 'true',
    NUDGES_FLOW_ID: 'ebc01d31-1976-46ce-a385-b0240327226c',
    LLM_PROVIDER: state.openRAG.llmProvider,
    LLM_MODEL: state.openRAG.llmModel,
    EMBEDDING_PROVIDER: state.openRAG.embeddingProvider,
    EMBEDDING_MODEL: state.openRAG.embeddingModel,
    OLLAMA_ENDPOINT: state.openRAG.ollamaEndpoint,
    FRONTEND_PORT: String(state.openRAG.frontendPort),
    LANGFLOW_PORT: String(state.openRAG.langflowPort),
    DOCLING_SERVE_URL: `http://host.docker.internal:${state.openRAG.doclingPort}`,
    ...openRAGProviderEnv(state),
  }
}

function openRAGProviderEnv(state) {
  if (!state.openRAG.useAgentProvider) return {}
  const provider = normalizeProvider(state.provider || {})
  const info = getProviderInfo(provider.provider)
  if (info.flag === 'openai') {
    return { OPENAI_API_KEY: provider.apiKey }
  }
  if (info.flag === 'anthropic') {
    return { ANTHROPIC_API_KEY: provider.apiKey }
  }
  return {}
}

async function openInteractiveTerminal(command, cwd, title) {
  if (process.platform === 'win32') {
    const result = await runCommand('cmd', ['/c', 'start', `"${title}"`, 'cmd', '/k', command], {
      cwd,
      timeoutMs: 30000,
    })
    return { ok: result.code === 0, ...result }
  }
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(`cd ${shellQuote(cwd)} && ${command}`)}`
    const result = await runCommand('osascript', ['-e', script], { cwd, timeoutMs: 30000 })
    return { ok: result.code === 0, ...result }
  }
  const terminals = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', `cd ${shellQuote(cwd)} && ${command}; exec bash`]],
    ['gnome-terminal', ['--', 'bash', '-lc', `cd ${shellQuote(cwd)} && ${command}; exec bash`]],
    ['konsole', ['-e', 'bash', '-lc', `cd ${shellQuote(cwd)} && ${command}; exec bash`]],
    ['xterm', ['-e', 'bash', '-lc', `cd ${shellQuote(cwd)} && ${command}; exec bash`]],
  ]
  for (const [terminal, args] of terminals) {
    if (await commandExists(terminal)) {
      const result = await runCommand(terminal, args, { cwd, timeoutMs: 30000 })
      return { ok: result.code === 0, terminal, ...result }
    }
  }
  return { ok: false, error: 'No supported desktop terminal found. Run scripts/release/start-openrag.sh manually.' }
}

async function commandExists(command) {
  const checker = process.platform === 'win32'
    ? ['where', [command]]
    : ['sh', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`]]
  const result = await runCommand(checker[0], checker[1], { cwd: ROOT_DIR, timeoutMs: 15000 })
  return result.code === 0
}

function releaseScript(name) {
  return path.join(SCRIPT_DIR, name)
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function generateComplexSecret() {
  return `OcRag-${randomBytes(12).toString('base64url')}!7aA`
}

function generateFernetKey() {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function normalizeFernetKey(value) {
  const text = String(value || '').trim()
  return /^[A-Za-z0-9_-]{43}=$/.test(text) ? text : generateFernetKey()
}

async function stopDocker(state) {
  const result = await runCommand('docker', ['compose', '-p', state.docker.projectName, '-f', 'docker-compose.agent-gateway.yml', 'down'], {
    cwd: ROOT_DIR,
    env: runtimeEnv(state),
    timeoutMs: 120000,
  })
  return { ok: result.code === 0, ...result }
}

async function runLocalSmoke(state) {
  const steps = []
  await pushStep(steps, 'Local health', () => fetchJson(`http://${loopbackHost(state.api.host)}:${state.api.port}/health`))
  await pushStep(steps, 'Local chat', async () => {
    const text = await chatCompletion(agentBaseUrl(state), state.api.apiKey, 'Reply exactly: GUI_LOCAL_OK')
    if (!text.includes('GUI_LOCAL_OK')) throw new Error(`unexpected reply: ${text}`)
    return text
  })
  await pushStep(steps, 'Local file action', async () => {
    const target = path.join(STATE_DIR, 'local-gui-smoke.txt')
    const text = await chatCompletion(agentBaseUrl(state), state.api.apiKey, `Create file ${target} with exactly GUI_LOCAL_FILE_OK and reply exactly GUI_LOCAL_FILE_DONE`)
    const content = await readFile(target, 'utf8')
    if (!content.includes('GUI_LOCAL_FILE_OK')) throw new Error('file content mismatch')
    return text
  })
  await pushStep(steps, 'Local cron run', () => cronSmoke(agentBaseUrl(state), state.api.apiKey, 'GUI_LOCAL_CRON_OK'))
  if (await isHttpOk(openWebUIUrl(state))) {
    await pushStep(steps, 'Local Open WebUI', () => fetchText(openWebUIUrl(state)))
  } else {
    pushSkippedStep(steps, 'Local Open WebUI', `${openWebUIUrl(state)} is not running`)
  }
  return { ok: steps.every(step => step.ok), steps }
}

async function runDockerSmoke(state) {
  const steps = []
  await pushStep(steps, 'Docker health', () => fetchJson(`http://127.0.0.1:${state.docker.apiHostPort}/health`))
  await pushStep(steps, 'Docker chat', async () => {
    const text = await chatCompletion(dockerAgentBaseUrl(state), state.api.apiKey, 'Reply exactly: GUI_DOCKER_OK')
    if (!text.includes('GUI_DOCKER_OK')) throw new Error(`unexpected reply: ${text}`)
    return text
  })
  await pushStep(steps, 'Docker file action', async () => {
    const target = path.join(STATE_DIR, 'docker-gui-smoke.txt')
    const text = await chatCompletion(dockerAgentBaseUrl(state), state.api.apiKey, 'Create file /workspace/.tmp-control-center/docker-gui-smoke.txt with exactly GUI_DOCKER_FILE_OK and reply exactly GUI_DOCKER_FILE_DONE')
    const content = await readFile(target, 'utf8')
    if (!content.includes('GUI_DOCKER_FILE_OK')) throw new Error('file content mismatch')
    return text
  })
  await pushStep(steps, 'Docker cron run', () => cronSmoke(dockerAgentBaseUrl(state), state.api.apiKey, 'GUI_DOCKER_CRON_OK'))
  if (await isHttpOk(dockerOpenWebUIUrl(state))) {
    await pushStep(steps, 'Docker Open WebUI', () => fetchText(dockerOpenWebUIUrl(state)))
  } else {
    pushSkippedStep(steps, 'Docker Open WebUI', `${dockerOpenWebUIUrl(state)} is not running`)
  }
  return { ok: steps.every(step => step.ok), steps }
}

async function runAllSmoke(state) {
  const local = await runLocalSmoke(state)
  let docker = { ok: true, skipped: true, steps: [{ name: 'Docker smoke', ok: true, skipped: true, output: 'Docker API is not running' }] }
  if (await isHttpOk(`http://127.0.0.1:${state.docker.apiHostPort}/health`)) {
    docker = await runDockerSmoke(state)
  }
  return { ok: local.ok && docker.ok, local, docker }
}

async function cronSmoke(baseUrl, apiKey, marker) {
  const created = await fetchJson(`${baseUrl.replace(/\/v1$/, '')}/api/jobs`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      name: `gui cron smoke ${Date.now()}`,
      prompt: `Reply exactly: ${marker}`,
      schedule: '2099-01-01T00:00:00Z',
      deliver: 'local',
    }),
    timeoutMs: 60000,
  })
  const jobId = created.job?.id
  if (!jobId) throw new Error('cron job id missing')
  const ran = await fetchJson(`${baseUrl.replace(/\/v1$/, '')}/api/jobs/${jobId}/run`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    timeoutMs: 260000,
  })
  if (ran.job?.lastStatus !== 'ok') throw new Error(`cron status: ${ran.job?.lastStatus}`)
  return ran.job.lastOutputFile || jobId
}

async function loadProviderModels(input) {
  const provider = normalizeProvider(input)
  const info = getProviderInfo(provider.provider)
  if (info.flag !== 'openai') {
    return { ok: false, models: [], message: 'Model loading is implemented for OpenAI-compatible providers. Enter model manually for this provider.' }
  }
  const urls = modelUrls(provider.baseUrl)
  const errors = []
  for (const url of urls) {
    try {
      const data = await fetchJson(url, { headers: authHeaders(provider.apiKey), timeoutMs: 30000 })
      const models = Array.isArray(data.data)
        ? data.data.map(item => item.id).filter(Boolean).sort()
        : []
      return { ok: true, models, source: url }
    } catch (error) {
      errors.push(`${url}: ${String(error?.message || error)}`)
    }
  }
  if (Array.isArray(info.models) && info.models.length > 0) {
    return {
      ok: true,
      models: info.models,
      source: 'provider preset',
      message: errors.length ? `Live model loading failed; using provider preset.\n${errors.join('\n')}` : undefined,
    }
  }
  return { ok: false, models: [], message: errors.join('\n') }
}

function modelUrls(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '')
  if (!trimmed) return []
  return trimmed.endsWith('/v1') ? [`${trimmed}/models`, `${trimmed.replace(/\/v1$/, '')}/v1/models`] : [`${trimmed}/v1/models`, `${trimmed}/models`]
}

async function getRuntimeStatus(state) {
  const localApi = await isHttpOk(`http://${loopbackHost(state.api.host)}:${state.api.port}/health`)
  const localWebUI = await isHttpOk(openWebUIUrl(state))
  const openRAG = await isHttpOk(openRAGUrl(state))
  const docling = await isHttpOk(doclingUrl(state))
  const camofox = await isHttpOk(`${state.camofox?.url || DEFAULT_CONFIG.camofox.url}/health`)
  const hindsight = await isHttpOk(state.hindsight?.url || DEFAULT_CONFIG.hindsight.url)
  const hindsightUI = await isHttpOk(hindsightUiUrl(state))
  const dockerApi = await isHttpOk(`http://127.0.0.1:${state.docker?.apiHostPort || 18642}/health`)
  const dockerWebUI = await isHttpOk(`http://127.0.0.1:${state.docker?.openWebUIHostPort || 28080}`)
  return { localApi, localWebUI, openRAG, docling, camofox, hindsight, hindsightUI, dockerApi, dockerWebUI }
}

async function ensureBuild() {
  if (existsSync(path.join(ROOT_DIR, 'dist', 'cli.mjs'))) return
  const result = await runCommand('bun', ['run', 'build'], { cwd: ROOT_DIR, timeoutMs: 180000 })
  if (result.code !== 0) throw new Error(`Build failed: ${result.stderr || result.stdout}`)
}

function runtimeEnv(state, extra = {}) {
  const env = { ...process.env, ...readEnvFileSyncSafe(), ...toEnvUpdates(normalizeState(state)), ...extra }
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
}

async function readEnvFile() {
  if (!existsSync(ENV_PATH)) return {}
  return parseEnv(await readFile(ENV_PATH, 'utf8'))
}

function readEnvFileSyncSafe() {
  try {
    return existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, 'utf8')) : {}
  } catch {
    return {}
  }
}

function parseEnv(raw) {
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function updateEnvFile(updates) {
  await updateEnvFileAt(ENV_PATH, updates)
}

async function updateEnvFileAt(file, updates) {
  const raw = existsSync(file) ? await readFile(file, 'utf8') : ''
  const lines = raw ? raw.split(/\r?\n/) : []
  const seen = new Set()
  const next = lines.map(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match) return line
    const key = match[1]
    if (!(key in updates)) return line
    seen.add(key)
    return `${key}=${quoteEnv(updates[key])}`
  })
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${quoteEnv(value)}`)
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${next.join('\n').replace(/\n+$/g, '')}\n`, 'utf8')
}

function quoteEnv(value) {
  const text = String(value ?? '')
  if (!text) return ''
  if (/[\s#"'`$]/.test(text)) return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return text
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return structuredClone(base)
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  return String(value || '').split(/[,\s]+/).map(item => item.trim()).filter(Boolean)
}

function toPort(value, fallback) {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback
}

function envBool(value, fallback) {
  if (value === undefined || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min
}

function generateApiKey() {
  return `ocag_${randomBytes(24).toString('base64url')}`
}

function maskSecret(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 8) return 'set'
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function parseCommand(commandLine) {
  const parts = String(commandLine || '').match(/(?:[^\s"]+|"[^"]*")+/g) || []
  const [command = process.platform === 'win32' ? 'py' : 'python3', ...args] = parts.map(part => part.replace(/^"|"$/g, ''))
  return { command, args }
}

function logFiles(name) {
  const outPath = path.join(STATE_DIR, `${name}.out.log`)
  const errPath = path.join(STATE_DIR, `${name}.err.log`)
  return {
    out: openSync(outPath, 'a'),
    err: openSync(errPath, 'a'),
    paths: { out: outPath, err: errPath },
  }
}

async function runCommand(command, args, options = {}) {
  const stdout = []
  const stderr = []
  const timeoutMs = options.timeoutMs || 120000
  return await new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: options.env || process.env,
      shell: process.platform === 'win32' && ['docker', 'bun', 'open-webui'].includes(command),
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ code: 124, stdout: stdout.join(''), stderr: `${stderr.join('')}\nTimed out after ${timeoutMs}ms` })
    }, timeoutMs)
    child.stdout?.on('data', data => stdout.push(data.toString()))
    child.stderr?.on('data', data => stderr.push(data.toString()))
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: 1, stdout: stdout.join(''), stderr: String(error.message || error) })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout: stdout.join(''), stderr: stderr.join('') })
    })
  })
}

async function runCheckedCommand(command, args, options = {}) {
  const result = await runCommand(command, args, options)
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.code}): ${result.stderr || result.stdout}`)
  }
  return result
}

async function stopProcessesByPorts(ports) {
  if (process.platform !== 'win32') {
    return { message: 'Use your process manager on this platform, or close the terminal that started the service.' }
  }
  const command = [
    '$ports=@(' + ports.join(',') + ');',
    '$ids=New-Object System.Collections.Generic.HashSet[int];',
    'foreach($port in $ports){Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue|Where-Object{$_.OwningProcess -and $_.OwningProcess -ne 0}|ForEach-Object{[void]$ids.Add([int]$_.OwningProcess)}}',
    '$stopped=@();',
    'foreach($procId in $ids){try{$p=Get-Process -Id $procId -ErrorAction Stop; Stop-Process -Id $procId -Force; $stopped += "$($procId):$($p.ProcessName)"}catch{}}',
    'Write-Output ($stopped -join ",")',
  ].join(' ')
  return await runCommand('powershell', ['-NoProfile', '-Command', command], { timeoutMs: 30000 })
}

async function pushStep(steps, name, fn) {
  const startedAt = Date.now()
  try {
    const output = await fn()
    steps.push({ name, ok: true, ms: Date.now() - startedAt, output: summarize(output) })
  } catch (error) {
    steps.push({ name, ok: false, ms: Date.now() - startedAt, output: String(error?.message || error) })
  }
}

function pushSkippedStep(steps, name, output) {
  steps.push({ name, ok: true, skipped: true, ms: 0, output })
}

function summarize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text
}

async function chatCompletion(baseUrl, apiKey, prompt) {
  const data = await fetchJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      model: 'openclaude-agent',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
    timeoutMs: 260000,
  })
  return data.choices?.[0]?.message?.content || ''
}

function authHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
    return text ? JSON.parse(text) : {}
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url) {
  const response = await fetch(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return text.slice(0, 200)
}

async function isHttpOk(url) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHttpOk(url)) return
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function loopbackHost(host) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
}

function agentBaseUrl(state) {
  return `http://${loopbackHost(state.api.host)}:${state.api.port}/v1`
}

function dockerAgentBaseUrl(state) {
  return `http://127.0.0.1:${state.docker.apiHostPort}/v1`
}

function openRAGUrl(state) {
  return state.openRAG.url || `http://localhost:${state.openRAG.frontendPort}`
}

function dockerOpenRAGUrl(state) {
  try {
    const url = new URL(openRAGUrl(state))
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) {
      url.hostname = 'host.docker.internal'
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return `http://host.docker.internal:${state.openRAG.frontendPort}`
  }
}

function dockerCamofoxUrl(state) {
  return dockerHostUrl(state.camofox?.url || DEFAULT_CONFIG.camofox.url)
}

function dockerHindsightUrl(state) {
  return dockerHostUrl(state.hindsight?.url || DEFAULT_CONFIG.hindsight.url)
}

function dockerHostUrl(value) {
  try {
    const url = new URL(value)
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) {
      url.hostname = 'host.docker.internal'
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return value
  }
}

function hindsightUiUrl(state) {
  return `http://localhost:${state.hindsight?.uiPort || DEFAULT_CONFIG.hindsight.uiPort}`
}

function doclingUrl(state) {
  return `http://127.0.0.1:${state.openRAG.doclingPort}/docs`
}

function openWebUIUrl(state) {
  return `http://${state.openWebUI.host}:${state.openWebUI.port}`
}

function dockerOpenWebUIUrl(state) {
  return `http://127.0.0.1:${state.docker.openWebUIHostPort}`
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

function html() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenClaude Control Center</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, Segoe UI, Arial, sans-serif; }
    body { margin: 0; background: #101418; color: #eef3f8; }
    header { padding: 20px 28px; background: #151b21; border-bottom: 1px solid #2b333c; position: sticky; top: 0; z-index: 5; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    main { max-width: 1260px; margin: 0 auto; padding: 22px; display: grid; gap: 16px; }
    section { border: 1px solid #2b333c; border-radius: 8px; padding: 16px; background: #151b21; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    label { display: grid; gap: 6px; font-size: 13px; color: #b7c3cf; }
    input, select, textarea, button { border-radius: 8px; border: 1px solid #3a4652; background: #0f1317; color: #eef3f8; padding: 10px; font: inherit; }
    textarea { min-height: 70px; resize: vertical; }
    input[type="checkbox"] { width: 18px; height: 18px; }
    .check { display: flex; align-items: center; gap: 10px; color: #eef3f8; }
    button { cursor: pointer; background: #1d6f63; border-color: #278778; font-weight: 650; }
    button.secondary { background: #26313b; border-color: #3a4652; }
    button.warn { background: #7a3f21; border-color: #a35b31; }
    button:disabled { opacity: .55; cursor: wait; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .mono { font-family: Consolas, Menlo, monospace; }
    .status { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
    .pill { border: 1px solid #3a4652; border-radius: 8px; padding: 10px; background: #0f1317; }
    .ok { color: #79e6a3; }
    .bad { color: #ff9c8a; }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid #2b333c; border-radius: 8px; background: #0f1317; padding: 12px; max-height: 360px; overflow: auto; }
    .small { color: #91a0ad; font-size: 12px; }
    @media (max-width: 900px) { .grid, .two, .three, .status { grid-template-columns: 1fr; } header { position: static; } }
  </style>
</head>
<body>
  <header>
    <h1>OpenClaude Control Center</h1>
    <div class="small">Настройка провайдера, Telegram, API, Open WebUI, cron, Ouroboros и Docker. Все сохраняется в .env и agent-gateway.json.</div>
  </header>
  <main>
    <section>
      <h2>Runtime</h2>
      <div class="grid" style="margin-bottom:12px">
        <label>Language / Язык
          <select id="language">
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <div class="status" id="status"></div>
      <div class="actions" style="margin-top:12px">
        <button onclick="refresh()">Refresh</button>
        <button class="secondary" onclick="save()">Save settings</button>
        <button class="secondary" onclick="testAll()">Test all running surfaces</button>
      </div>
    </section>

    <section>
      <h2>Provider</h2>
      <div class="grid">
        <label>Provider<select id="provider"></select></label>
        <label>Base URL<input id="providerBaseUrl" placeholder="https://api..."></label>
        <label>Model<input id="providerModel" list="modelList" placeholder="model name"></label>
        <label>API key<input id="providerApiKey" type="password" autocomplete="off"></label>
      </div>
      <datalist id="modelList"></datalist>
      <div class="actions" style="margin-top:12px">
        <button onclick="loadModels()">Load models</button>
        <button class="secondary" onclick="save()">Save provider</button>
      </div>
    </section>

    <section>
      <h2>Agent API</h2>
      <div class="grid">
        <label class="check"><input id="apiEnabled" type="checkbox"> Enable API</label>
        <label>Host<input id="apiHost"></label>
        <label>Port<input id="apiPort" type="number"></label>
        <label>Model alias<input id="apiModel"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>API key<input id="apiKey" type="password" autocomplete="off"></label>
        <label>Base URL<input id="apiBaseUrl" class="mono" readonly></label>
        <label>CORS origins<input id="apiCors"></label>
        <label class="check"><input id="autoAccept" type="checkbox"> Auto accept / full tool access</label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Runner max turns<input id="runnerMaxTurns" type="number"></label>
        <label>Runner timeout ms<input id="runnerTimeoutMs" type="number"></label>
        <label>Available tools<input id="availableTools" placeholder="empty = all, or Bash,Read,Write"></label>
        <label>Disallowed tools<input id="disallowedTools" placeholder="Bash,WebSearch"></label>
      </div>
      <div class="actions" style="margin-top:12px">
        <button onclick="generateKey()">Generate API key</button>
        <button onclick="copyApi()">Copy API data</button>
        <button onclick="startLocal()">Start API</button>
        <button class="warn" onclick="stopLocal()">Stop API</button>
        <button class="secondary" onclick="testLocal()">Test local API</button>
      </div>
    </section>

    <section>
      <h2>Cron, Ouroboros, background consciousness</h2>
      <div class="grid">
        <label class="check"><input id="cronEnabled" type="checkbox"> Cron scheduler enabled</label>
        <label>Cron tick seconds<input id="cronTick" type="number"></label>
        <label class="check"><input id="ouroEnabled" type="checkbox"> Evolution enabled</label>
        <label class="check"><input id="consciousnessEnabled" type="checkbox"> Background consciousness</label>
        <label class="check"><input id="infiniteTasksEnabled" type="checkbox"> Infinite tasks</label>
        <label>Wakeup min seconds<input id="wakeupMin" type="number"></label>
        <label>Wakeup max seconds<input id="wakeupMax" type="number"></label>
        <label>Max rounds<input id="maxRounds" type="number"></label>
        <label>Budget fraction<input id="budgetFraction" type="number" min="0" max="1" step="0.01"></label>
      </div>
    </section>

    <section>
      <h2>Telegram gateway</h2>
      <div class="grid">
        <label class="check"><input id="telegramEnabled" type="checkbox"> Telegram enabled</label>
        <label>Bot token<input id="botToken" type="password" autocomplete="off"></label>
        <label>Home chat id<input id="homeChatId"></label>
        <label>Allowed user ids<input id="allowedUserIds" placeholder="123,456"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Allowed chat ids<input id="allowedChatIds" placeholder="123,-100..."></label>
        <label class="check"><input id="mirrorApi" type="checkbox"> Mirror API responses to TG</label>
        <label class="check"><input id="downloadFiles" type="checkbox"> Download files</label>
        <label class="check"><input id="transcribeAudio" type="checkbox"> Voice transcription</label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Max download bytes<input id="maxDownloadBytes" type="number"></label>
        <label>Max upload bytes<input id="maxUploadBytes" type="number"></label>
        <label>Transcription provider
          <select id="transcriptionProvider">
            <option value="auto">auto</option>
            <option value="whisper">whisper</option>
            <option value="parakeet">parakeet</option>
            <option value="openai">openai</option>
          </select>
        </label>
        <label>OpenAI STT model<input id="transcriptionOpenAIModel"></label>
      </div>
    </section>

    <section>
      <h2>Open WebUI</h2>
      <div class="grid">
        <label>Host<input id="webuiHost"></label>
        <label>Port<input id="webuiPort" type="number"></label>
        <label>Python command<input id="pythonCommand"></label>
        <label>Data dir<input id="webuiDataDir"></label>
      </div>
      <div class="actions" style="margin-top:12px">
        <button onclick="installWebUI()">Install Open WebUI</button>
        <button onclick="startWebUI()">Start Open WebUI</button>
        <button class="secondary" onclick="openUrl('webui')">Open WebUI</button>
      </div>
      <div class="small">Auth is forced off with WEBUI_AUTH=False, so old login/account state should not block local usage.</div>
    </section>

    <section>
      <h2>OpenRAG</h2>
      <div class="grid">
        <label class="check"><input id="openragEnabled" type="checkbox"> OpenRAG enabled</label>
        <label>OpenRAG URL<input id="openragUrl" placeholder="http://localhost:3000"></label>
        <label>OpenRAG API key<input id="openragApiKey" type="password" autocomplete="off"></label>
        <label class="check"><input id="openragUseAgentProvider" type="checkbox"> Pass current provider key to OpenRAG Docker</label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Repo dir<input id="openragRepoDir"></label>
        <label>Workspace dir<input id="openragWorkspaceDir"></label>
        <label>Frontend port<input id="openragFrontendPort" type="number"></label>
        <label>Langflow port<input id="openragLangflowPort" type="number"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Docling port<input id="openragDoclingPort" type="number"></label>
        <label>OpenSearch password<input id="openragOpenSearchPassword" type="password" autocomplete="off" placeholder="auto-generated for Docker"></label>
        <label>Langflow user<input id="openragLangflowUser"></label>
        <label>Langflow password<input id="openragLangflowPassword" type="password" autocomplete="off" placeholder="auto-generated for Docker"></label>
        <label>OpenRAG LLM provider<select id="openragLlmProvider"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="watsonx">WatsonX</option><option value="ollama">Ollama</option></select></label>
        <label>OpenRAG LLM model<input id="openragLlmModel" placeholder="optional"></label>
        <label>OpenRAG embedding provider<select id="openragEmbeddingProvider"><option value="openai">OpenAI</option><option value="watsonx">WatsonX</option><option value="ollama">Ollama</option></select></label>
        <label>OpenRAG embedding model<input id="openragEmbeddingModel" placeholder="text-embedding-3-small / nomic-embed-text"></label>
        <label>OpenRAG Ollama endpoint<input id="openragOllamaEndpoint" placeholder="http://host.docker.internal:11434"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label class="check"><input id="openragMcpEnabled" type="checkbox"> Expose OpenRAG as MCP</label>
        <label>MCP command<input id="openragMcpCommand" placeholder="node"></label>
        <label>MCP args<input id="openragMcpArgs" placeholder="${escapeHtml(OPENRAG_MCP_BRIDGE_ARG)}"></label>
        <label>MCP timeout seconds<input id="openragMcpTimeout" type="number"></label>
      </div>
      <div class="actions" style="margin-top:12px">
        <button onclick="installOpenRAG()">Install / update OpenRAG</button>
        <button onclick="startOpenRAGTui()">Start OpenRAG TUI</button>
        <button onclick="startOpenRAGDocker()">Start OpenRAG Docker</button>
        <button class="warn" onclick="stopOpenRAGDocker()">Stop OpenRAG Docker</button>
        <button class="secondary" onclick="createOpenRAGKey()">Create API key + MCP</button>
        <button class="secondary" onclick="configureOpenRAGMcp()">Configure MCP</button>
        <button class="secondary" onclick="testOpenRAG()">Test OpenRAG</button>
        <button class="secondary" onclick="openUrl('openrag')">Open OpenRAG</button>
      </div>
      <div class="small">OpenRAG MCP uses the local OpenClaude bridge by default. It supports search, file ingestion, settings, models, and a chat fallback over retrieval. On Windows, OpenRAG officially expects WSL; the scripts use WSL when available.</div>
    </section>

    <section>
      <h2>Camofox browser MCP</h2>
      <div class="grid">
        <label class="check"><input id="camofoxEnabled" type="checkbox"> Camofox enabled</label>
        <label class="check"><input id="camofoxMcpEnabled" type="checkbox"> Expose Camofox as MCP</label>
        <label>Camofox URL<input id="camofoxUrl" placeholder="http://localhost:9377"></label>
        <label>Camofox port<input id="camofoxPort" type="number"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Access key<input id="camofoxAccessKey" type="password" autocomplete="off"></label>
        <label>API key<input id="camofoxApiKey" type="password" autocomplete="off"></label>
        <label>MCP user id<input id="camofoxUserId"></label>
        <label>MCP session key<input id="camofoxSessionKey"></label>
        <label>MCP timeout seconds<input id="camofoxMcpTimeout" type="number"></label>
      </div>
      <div class="actions" style="margin-top:12px">
        <button class="secondary" onclick="configureCamofoxMcp()">Configure Camofox MCP</button>
        <button class="secondary" onclick="testCamofox()">Test Camofox</button>
      </div>
      <div class="small">Camofox is the live browser surface. The agent uses camofox_* tools for pages, screenshots, clicking, typing, and browser snapshots.</div>
    </section>

    <section>
      <h2>Hindsight memory</h2>
      <div class="grid">
        <label class="check"><input id="hindsightEnabled" type="checkbox"> Hindsight enabled</label>
        <label class="check"><input id="hindsightMcpEnabled" type="checkbox"> Expose Hindsight as MCP</label>
        <label>Hindsight API URL<input id="hindsightUrl" placeholder="http://localhost:8888"></label>
        <label>Bank id<input id="hindsightBankId" placeholder="openclaude-agent"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Bridge API key<input id="hindsightApiKey" type="password" autocomplete="off"></label>
        <label>API port<input id="hindsightApiPort" type="number"></label>
        <label>UI port<input id="hindsightUiPort" type="number"></label>
        <label>MCP timeout seconds<input id="hindsightMcpTimeout" type="number"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label class="check"><input id="hindsightUseAgentProvider" type="checkbox"> Pass current provider to Hindsight Docker</label>
        <label>Hindsight LLM provider<input id="hindsightLlmProvider" placeholder="openai"></label>
        <label>Hindsight LLM model<input id="hindsightLlmModel" placeholder="optional"></label>
        <label>Hindsight LLM base URL<input id="hindsightLlmBaseUrl" placeholder="optional"></label>
        <label>Hindsight LLM API key<input id="hindsightLlmApiKey" type="password" autocomplete="off"></label>
      </div>
      <div class="actions" style="margin-top:12px">
        <button onclick="startHindsightDocker()">Start Hindsight Docker</button>
        <button class="warn" onclick="stopHindsightDocker()">Stop Hindsight Docker</button>
        <button class="secondary" onclick="configureHindsightMcp()">Configure Hindsight MCP</button>
        <button class="secondary" onclick="testHindsight()">Test Hindsight</button>
        <button class="secondary" onclick="openUrl('hindsight')">Open Hindsight UI</button>
      </div>
      <div class="small">Hindsight is durable memory. The agent uses hindsight_* tools for user/project memory, learned preferences, and reflection over retained context.</div>
    </section>

    <section>
      <h2>Docker</h2>
      <div class="grid">
        <label>Compose project<input id="dockerProject"></label>
        <label>Agent host port<input id="dockerApiPort" type="number"></label>
        <label>Open WebUI host port<input id="dockerWebuiPort" type="number"></label>
        <label>Docker API Base URL<input id="dockerBaseUrl" class="mono" readonly></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label class="check"><input id="dockerUseMainProvider" type="checkbox"> Reuse local provider/API</label>
        <label>Docker provider<select id="dockerProvider"></select></label>
        <label>Docker base URL<input id="dockerProviderBaseUrl" placeholder="https://api..."></label>
        <label>Docker model<input id="dockerProviderModel" list="modelList" placeholder="model name"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Docker API key<input id="dockerProviderApiKey" type="password" autocomplete="off"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label class="check"><input id="dockerTelegramEnabled" type="checkbox"> Enable Telegram in Docker</label>
        <label class="check"><input id="dockerTelegramUseMain" type="checkbox"> Reuse local Telegram settings</label>
        <label>Docker bot token<input id="dockerBotToken" type="password" autocomplete="off"></label>
        <label>Docker home chat id<input id="dockerHomeChatId"></label>
      </div>
      <div class="grid" style="margin-top:12px">
        <label>Docker allowed user ids<input id="dockerAllowedUserIds" placeholder="123,456"></label>
        <label>Docker allowed chat ids<input id="dockerAllowedChatIds" placeholder="123,-100..."></label>
      </div>
      <div class="small">Docker can inherit the local provider or use a separate API/model. Docker Telegram is off by default to avoid two running instances replying from the same bot.</div>
      <div class="actions" style="margin-top:12px">
        <button class="secondary" onclick="loadDockerModels()">Load Docker models</button>
        <button class="secondary" onclick="configureAllMcp()">Configure all MCP</button>
        <button onclick="startDocker()">Start Docker</button>
        <button class="warn" onclick="stopDocker()">Stop Docker</button>
        <button class="secondary" onclick="testDocker()">Test Docker</button>
        <button class="secondary" onclick="openUrl('dockerWebui')">Open Docker WebUI</button>
      </div>
    </section>

    <section>
      <h2>Logs and tests</h2>
      <pre id="log">Loading...</pre>
    </section>
  </main>
  <script>
    let state = null;
    const $ = id => document.getElementById(id);
    const ids = ['language','provider','providerBaseUrl','providerModel','providerApiKey','apiEnabled','apiHost','apiPort','apiModel','apiKey','apiCors','autoAccept','runnerMaxTurns','runnerTimeoutMs','availableTools','disallowedTools','cronEnabled','cronTick','ouroEnabled','consciousnessEnabled','infiniteTasksEnabled','wakeupMin','wakeupMax','maxRounds','budgetFraction','telegramEnabled','botToken','homeChatId','allowedUserIds','allowedChatIds','mirrorApi','downloadFiles','transcribeAudio','maxDownloadBytes','maxUploadBytes','transcriptionProvider','transcriptionOpenAIModel','webuiHost','webuiPort','pythonCommand','webuiDataDir','openragEnabled','openragUrl','openragApiKey','openragUseAgentProvider','openragRepoDir','openragWorkspaceDir','openragFrontendPort','openragLangflowPort','openragDoclingPort','openragOpenSearchPassword','openragLangflowUser','openragLangflowPassword','openragLlmProvider','openragLlmModel','openragEmbeddingProvider','openragEmbeddingModel','openragOllamaEndpoint','openragMcpEnabled','openragMcpCommand','openragMcpArgs','openragMcpTimeout','camofoxEnabled','camofoxMcpEnabled','camofoxUrl','camofoxPort','camofoxAccessKey','camofoxApiKey','camofoxUserId','camofoxSessionKey','camofoxMcpTimeout','hindsightEnabled','hindsightMcpEnabled','hindsightUrl','hindsightBankId','hindsightApiKey','hindsightApiPort','hindsightUiPort','hindsightMcpTimeout','hindsightUseAgentProvider','hindsightLlmProvider','hindsightLlmModel','hindsightLlmBaseUrl','hindsightLlmApiKey','dockerProject','dockerApiPort','dockerWebuiPort','dockerUseMainProvider','dockerProvider','dockerProviderBaseUrl','dockerProviderModel','dockerProviderApiKey','dockerTelegramEnabled','dockerTelegramUseMain','dockerBotToken','dockerHomeChatId','dockerAllowedUserIds','dockerAllowedChatIds'];

    function log(message) {
      const text = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
      $('log').textContent = text;
    }
    async function api(path, body, method = 'POST') {
      const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || data.message || JSON.stringify(data));
      return data;
    }
    async function refresh() {
      const res = await fetch('/api/state');
      state = await res.json();
      render();
      log('Loaded settings from ' + state.configPath);
    }
    function render() {
      $('language').value = state.ui?.language || 'ru';
      $('provider').innerHTML = state.providers.map(p => '<option value="'+p.value+'">'+p.label+'</option>').join('');
      $('provider').value = state.provider.provider;
      $('providerBaseUrl').value = state.provider.baseUrl || '';
      $('providerModel').value = state.provider.model || '';
      $('providerApiKey').value = state.provider.apiKey || '';
      $('apiEnabled').checked = !!state.api.enabled;
      $('apiHost').value = state.api.host;
      $('apiPort').value = state.api.port;
      $('apiModel').value = state.api.modelName;
      $('apiKey').value = state.api.apiKey || '';
      $('apiCors').value = (state.api.corsOrigins || []).join(',');
      $('autoAccept').checked = state.runner.permissionMode === 'bypassPermissions';
      $('runnerMaxTurns').value = state.runner.maxTurns || 24;
      $('runnerTimeoutMs').value = state.runner.timeoutMs || 600000;
      $('availableTools').value = (state.runner.availableTools || []).join(',');
      $('disallowedTools').value = (state.runner.disallowedTools || []).join(',');
      $('cronEnabled').checked = state.cron.enabled !== false;
      $('cronTick').value = state.cron.tickIntervalSeconds;
      $('ouroEnabled').checked = !!state.ouroboros.enabled;
      $('consciousnessEnabled').checked = !!state.ouroboros.consciousnessEnabled;
      $('infiniteTasksEnabled').checked = !!state.ouroboros.infiniteTasksEnabled;
      $('wakeupMin').value = state.ouroboros.wakeupMinSeconds;
      $('wakeupMax').value = state.ouroboros.wakeupMaxSeconds;
      $('maxRounds').value = state.ouroboros.maxRounds;
      $('budgetFraction').value = state.ouroboros.budgetFraction ?? 0.1;
      $('telegramEnabled').checked = !!state.telegram.enabled;
      $('botToken').value = state.telegram.botToken || '';
      $('homeChatId').value = state.telegram.homeChatId || '';
      $('allowedUserIds').value = (state.telegram.allowedUserIds || []).join(',');
      $('allowedChatIds').value = (state.telegram.allowedChatIds || []).join(',');
      $('mirrorApi').checked = state.telegram.mirrorAgentApiResponses !== false;
      $('downloadFiles').checked = state.telegram.downloadFiles !== false;
      $('transcribeAudio').checked = state.telegram.transcribeAudio !== false;
      $('maxDownloadBytes').value = state.telegram.maxDownloadBytes || 20971520;
      $('maxUploadBytes').value = state.telegram.maxUploadBytes || 52428800;
      $('transcriptionProvider').value = state.telegram.transcriptionProvider || 'auto';
      $('transcriptionOpenAIModel').value = state.telegram.transcriptionOpenAIModel || 'whisper-1';
      $('webuiHost').value = state.openWebUI.host;
      $('webuiPort').value = state.openWebUI.port;
      $('pythonCommand').value = state.openWebUI.pythonCommand;
      $('webuiDataDir').value = state.openWebUI.dataDir || '';
      $('openragEnabled').checked = !!state.openRAG?.enabled;
      $('openragUrl').value = state.openRAG?.url || 'http://localhost:3000';
      $('openragApiKey').value = state.openRAG?.apiKey || '';
      $('openragUseAgentProvider').checked = state.openRAG?.useAgentProvider !== false;
      $('openragRepoDir').value = state.openRAG?.repoDir || '';
      $('openragWorkspaceDir').value = state.openRAG?.workspaceDir || '';
      $('openragFrontendPort').value = state.openRAG?.frontendPort || 3000;
      $('openragLangflowPort').value = state.openRAG?.langflowPort || 7860;
      $('openragDoclingPort').value = state.openRAG?.doclingPort || 5001;
      $('openragOpenSearchPassword').value = state.openRAG?.openSearchPassword || '';
      $('openragLangflowUser').value = state.openRAG?.langflowSuperuser || 'admin';
      $('openragLangflowPassword').value = state.openRAG?.langflowSuperuserPassword || '';
      $('openragLlmProvider').value = state.openRAG?.llmProvider || 'openai';
      $('openragLlmModel').value = state.openRAG?.llmModel || '';
      $('openragEmbeddingProvider').value = state.openRAG?.embeddingProvider || 'openai';
      $('openragEmbeddingModel').value = state.openRAG?.embeddingModel || 'text-embedding-3-small';
      $('openragOllamaEndpoint').value = state.openRAG?.ollamaEndpoint || 'http://host.docker.internal:11434';
      $('openragMcpEnabled').checked = !!state.openRAG?.mcpEnabled;
      $('openragMcpCommand').value = state.openRAG?.mcpCommand || 'node';
      $('openragMcpArgs').value = (state.openRAG?.mcpArgs || [${JSON.stringify(OPENRAG_MCP_BRIDGE_ARG)}]).join(',');
      $('openragMcpTimeout').value = state.openRAG?.mcpTimeoutSeconds || 60;
      $('camofoxEnabled').checked = state.camofox?.enabled !== false;
      $('camofoxMcpEnabled').checked = state.camofox?.mcpEnabled !== false;
      $('camofoxUrl').value = state.camofox?.url || 'http://localhost:9377';
      $('camofoxPort').value = state.camofox?.port || 9377;
      $('camofoxAccessKey').value = state.camofox?.accessKey || '';
      $('camofoxApiKey').value = state.camofox?.apiKey || '';
      $('camofoxUserId').value = state.camofox?.userId || 'openclaude-agent';
      $('camofoxSessionKey').value = state.camofox?.sessionKey || 'default';
      $('camofoxMcpTimeout').value = state.camofox?.mcpTimeoutSeconds || 60;
      $('hindsightEnabled').checked = state.hindsight?.enabled !== false;
      $('hindsightMcpEnabled').checked = state.hindsight?.mcpEnabled !== false;
      $('hindsightUrl').value = state.hindsight?.url || 'http://localhost:8888';
      $('hindsightBankId').value = state.hindsight?.bankId || 'openclaude-agent';
      $('hindsightApiKey').value = state.hindsight?.apiKey || '';
      $('hindsightApiPort').value = state.hindsight?.apiPort || 8888;
      $('hindsightUiPort').value = state.hindsight?.uiPort || 9999;
      $('hindsightMcpTimeout').value = state.hindsight?.mcpTimeoutSeconds || 60;
      $('hindsightUseAgentProvider').checked = state.hindsight?.useAgentProvider !== false;
      $('hindsightLlmProvider').value = state.hindsight?.llmProvider || 'openai';
      $('hindsightLlmModel').value = state.hindsight?.llmModel || '';
      $('hindsightLlmBaseUrl').value = state.hindsight?.llmBaseUrl || '';
      $('hindsightLlmApiKey').value = state.hindsight?.llmApiKey || '';
      $('dockerProject').value = state.docker.projectName;
      $('dockerApiPort').value = state.docker.apiHostPort;
      $('dockerWebuiPort').value = state.docker.openWebUIHostPort;
      $('dockerProvider').innerHTML = state.providers.map(p => '<option value="'+p.value+'">'+p.label+'</option>').join('');
      $('dockerUseMainProvider').checked = state.docker.provider?.useMainProvider !== false;
      $('dockerProvider').value = state.docker.provider?.provider || 'openai-compatible';
      $('dockerProviderBaseUrl').value = state.docker.provider?.baseUrl || '';
      $('dockerProviderModel').value = state.docker.provider?.model || '';
      $('dockerProviderApiKey').value = state.docker.provider?.apiKey || '';
      $('dockerTelegramEnabled').checked = !!state.docker.telegram?.enabled;
      $('dockerTelegramUseMain').checked = !!state.docker.telegram?.useMainTelegram;
      $('dockerBotToken').value = state.docker.telegram?.botToken || '';
      $('dockerHomeChatId').value = state.docker.telegram?.homeChatId || '';
      $('dockerAllowedUserIds').value = (state.docker.telegram?.allowedUserIds || []).join(',');
      $('dockerAllowedChatIds').value = (state.docker.telegram?.allowedChatIds || []).join(',');
      updateComputed();
      renderStatus(state.status || {});
    }
    function collect() {
      return {
        provider: { provider: $('provider').value, baseUrl: $('providerBaseUrl').value, model: $('providerModel').value, apiKey: $('providerApiKey').value },
        api: { enabled: $('apiEnabled').checked, host: $('apiHost').value, port: Number($('apiPort').value), apiKey: $('apiKey').value, modelName: $('apiModel').value, corsOrigins: $('apiCors').value },
        cron: { enabled: $('cronEnabled').checked, tickIntervalSeconds: Number($('cronTick').value) },
        telegram: { enabled: $('telegramEnabled').checked, botToken: $('botToken').value, homeChatId: $('homeChatId').value, allowedUserIds: $('allowedUserIds').value, allowedChatIds: $('allowedChatIds').value, mirrorAgentApiResponses: $('mirrorApi').checked, downloadFiles: $('downloadFiles').checked, maxDownloadBytes: Number($('maxDownloadBytes').value), maxUploadBytes: Number($('maxUploadBytes').value), transcribeAudio: $('transcribeAudio').checked, transcriptionProvider: $('transcriptionProvider').value, transcriptionOpenAIModel: $('transcriptionOpenAIModel').value, transcriptionWhisperModel: state?.telegram?.transcriptionWhisperModel || 'base', replyWithTranscript: true },
        ouroboros: { enabled: $('ouroEnabled').checked, consciousnessEnabled: $('consciousnessEnabled').checked, infiniteTasksEnabled: $('infiniteTasksEnabled').checked, wakeupMinSeconds: Number($('wakeupMin').value), wakeupMaxSeconds: Number($('wakeupMax').value), maxRounds: Number($('maxRounds').value), budgetFraction: Number($('budgetFraction').value) },
        openWebUI: { host: $('webuiHost').value, port: Number($('webuiPort').value), pythonCommand: $('pythonCommand').value, dataDir: $('webuiDataDir').value },
        openRAG: { enabled: $('openragEnabled').checked, url: $('openragUrl').value, apiKey: $('openragApiKey').value, useAgentProvider: $('openragUseAgentProvider').checked, repoDir: $('openragRepoDir').value, workspaceDir: $('openragWorkspaceDir').value, frontendPort: Number($('openragFrontendPort').value), langflowPort: Number($('openragLangflowPort').value), doclingPort: Number($('openragDoclingPort').value), openSearchPassword: $('openragOpenSearchPassword').value, langflowSuperuser: $('openragLangflowUser').value, langflowSuperuserPassword: $('openragLangflowPassword').value, llmProvider: $('openragLlmProvider').value, llmModel: $('openragLlmModel').value, embeddingProvider: $('openragEmbeddingProvider').value, embeddingModel: $('openragEmbeddingModel').value, ollamaEndpoint: $('openragOllamaEndpoint').value, mcpEnabled: $('openragMcpEnabled').checked, mcpCommand: $('openragMcpCommand').value, mcpArgs: $('openragMcpArgs').value, mcpTimeoutSeconds: Number($('openragMcpTimeout').value) },
        camofox: { enabled: $('camofoxEnabled').checked, mcpEnabled: $('camofoxMcpEnabled').checked, url: $('camofoxUrl').value, port: Number($('camofoxPort').value), accessKey: $('camofoxAccessKey').value, apiKey: $('camofoxApiKey').value, userId: $('camofoxUserId').value, sessionKey: $('camofoxSessionKey').value, mcpTimeoutSeconds: Number($('camofoxMcpTimeout').value) },
        hindsight: { enabled: $('hindsightEnabled').checked, mcpEnabled: $('hindsightMcpEnabled').checked, url: $('hindsightUrl').value, apiKey: $('hindsightApiKey').value, bankId: $('hindsightBankId').value, apiPort: Number($('hindsightApiPort').value), uiPort: Number($('hindsightUiPort').value), mcpTimeoutSeconds: Number($('hindsightMcpTimeout').value), useAgentProvider: $('hindsightUseAgentProvider').checked, llmProvider: $('hindsightLlmProvider').value, llmModel: $('hindsightLlmModel').value, llmBaseUrl: $('hindsightLlmBaseUrl').value, llmApiKey: $('hindsightLlmApiKey').value },
        runner: { cwd: state.rootDir, maxTurns: Number($('runnerMaxTurns').value), timeoutMs: Number($('runnerTimeoutMs').value), permissionMode: $('autoAccept').checked ? 'bypassPermissions' : 'default', availableTools: $('availableTools').value, disallowedTools: $('disallowedTools').value },
        docker: { projectName: $('dockerProject').value, apiHostPort: Number($('dockerApiPort').value), openWebUIHostPort: Number($('dockerWebuiPort').value), provider: { useMainProvider: $('dockerUseMainProvider').checked, provider: $('dockerProvider').value, baseUrl: $('dockerProviderBaseUrl').value, model: $('dockerProviderModel').value, apiKey: $('dockerProviderApiKey').value }, telegram: { enabled: $('dockerTelegramEnabled').checked, useMainTelegram: $('dockerTelegramUseMain').checked, botToken: $('dockerBotToken').value, homeChatId: $('dockerHomeChatId').value, allowedUserIds: $('dockerAllowedUserIds').value, allowedChatIds: $('dockerAllowedChatIds').value } },
        ui: { language: $('language').value || 'ru' }
      };
    }
    function updateComputed() {
      $('apiBaseUrl').value = 'http://' + (($('apiHost').value === '0.0.0.0') ? '127.0.0.1' : $('apiHost').value) + ':' + $('apiPort').value + '/v1';
      $('dockerBaseUrl').value = 'http://127.0.0.1:' + $('dockerApiPort').value + '/v1';
    }
    function renderStatus(status) {
      const items = [
        ['Local API', status.localApi],
        ['Local Open WebUI', status.localWebUI],
        ['OpenRAG', status.openRAG],
        ['Docling', status.docling],
        ['Camofox', status.camofox],
        ['Hindsight API', status.hindsight],
        ['Hindsight UI', status.hindsightUI],
        ['Docker API', status.dockerApi],
        ['Docker Open WebUI', status.dockerWebUI],
      ];
      $('status').innerHTML = items.map(([name, ok]) => '<div class="pill"><b>'+name+'</b><br><span class="'+(ok?'ok':'bad')+'">'+(ok?'running':'stopped')+'</span></div>').join('');
    }
    async function save() { state = (await api('/api/save', collect())).state; render(); log('Settings saved.'); }
    async function generateKey() { $('apiKey').value = (await api('/api/generate-key', {})).apiKey; updateComputed(); }
    async function copyApi() { await navigator.clipboard.writeText('Base URL: '+$('apiBaseUrl').value+'\\nAPI key: '+$('apiKey').value); log('API data copied.'); }
    async function loadModels() { const data = await api('/api/provider/models', collect().provider); $('modelList').innerHTML = (data.models || []).map(m => '<option value="'+m+'"></option>').join(''); log(data); }
    async function loadDockerModels() { const data = await api('/api/provider/models', collect().docker.provider); $('modelList').innerHTML = (data.models || []).map(m => '<option value="'+m+'"></option>').join(''); log(data); }
    async function startLocal() { log(await api('/api/start/local', collect())); await refresh(); }
    async function stopLocal() { log(await api('/api/stop/local', {})); await refresh(); }
    async function installWebUI() { log(await api('/api/openwebui/install', collect())); }
    async function startWebUI() { log(await api('/api/openwebui/start', collect())); await refresh(); }
    async function installOpenRAG() { log(await api('/api/openrag/install', collect())); await refresh(); }
    async function startOpenRAGTui() { log(await api('/api/openrag/start-tui', collect())); await refresh(); }
    async function startOpenRAGDocker() { log(await api('/api/openrag/start-docker', collect())); await refresh(); }
    async function stopOpenRAGDocker() { log(await api('/api/openrag/stop-docker', collect())); await refresh(); }
    async function createOpenRAGKey() { log(await api('/api/openrag/create-key', collect())); await refresh(); }
    async function configureOpenRAGMcp() { log(await api('/api/openrag/configure-mcp', collect())); await refresh(); }
    async function testOpenRAG() { log(await api('/api/openrag/test', collect())); await refresh(); }
    async function configureCamofoxMcp() { log(await api('/api/camofox/configure-mcp', collect())); await refresh(); }
    async function testCamofox() { log(await api('/api/camofox/test', collect())); await refresh(); }
    async function startHindsightDocker() { log(await api('/api/hindsight/start-docker', collect())); await refresh(); }
    async function stopHindsightDocker() { log(await api('/api/hindsight/stop-docker', collect())); await refresh(); }
    async function configureHindsightMcp() { log(await api('/api/hindsight/configure-mcp', collect())); await refresh(); }
    async function testHindsight() { log(await api('/api/hindsight/test', collect())); await refresh(); }
    async function configureAllMcp() { log(await api('/api/mcp/configure-all', collect())); await refresh(); }
    async function startDocker() { log(await api('/api/docker/start', collect())); await refresh(); }
    async function stopDocker() { log(await api('/api/docker/stop', collect())); await refresh(); }
    async function testLocal() { log(await api('/api/test/local', collect())); await refresh(); }
    async function testDocker() { log(await api('/api/test/docker', collect())); await refresh(); }
    async function testAll() { log(await api('/api/test/all', collect())); await refresh(); }
    function openUrl(kind) {
      const url = kind === 'dockerWebui' ? 'http://127.0.0.1:'+$('dockerWebuiPort').value : kind === 'openrag' ? $('openragUrl').value : kind === 'hindsight' ? 'http://localhost:'+$('hindsightUiPort').value : 'http://'+$('webuiHost').value+':'+$('webuiPort').value;
      window.open(url, '_blank');
    }
    ids.forEach(id => window.addEventListener('input', e => { if (e.target && e.target.id === id) updateComputed(); }));
    refresh().catch(err => log(String(err)));
  </script>
</body>
</html>`
}

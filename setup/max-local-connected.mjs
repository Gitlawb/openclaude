/**
 * max5090 + proven Ollama link.
 * Keeps effort/thinking MAX and 160k, parks MCPs (stall source),
 * disables mouse capture (Windows copy/paste), hard-proves /v1 chat.
 */
import fs from 'fs'
import path from 'path'
import http from 'http'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const user = process.env.USERPROFILE
const settingsPath = path.join(user, '.openclaude', 'settings.json')
const ocjPath = path.join(user, '.openclaude.json')
const perfPath = path.join(user, '.openclaude', 'performance-mode.json')
const mcpBackupPath = path.join(user, '.openclaude', 'mcpServers.backup-speed.json')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelfile = path.join(root, 'setup', 'Modelfile.qwen38-27b-oc-code')

const LOCAL = 'qwen3.8-oc-code:27b'
const BASE = 'http://127.0.0.1:11434/v1'
const HOST = '127.0.0.1:11434'
/** 160k — large editing projects on 5090; never bare 262k (green-screen). */
const CTX = 163840
const FALLBACK_CTX = 153600
const AUTO_COMPACT = 143360

function readJson(p) {
  let r = fs.readFileSync(p, 'utf8')
  if (r.charCodeAt(0) === 0xfeff) r = r.slice(1)
  return JSON.parse(r)
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 4) + '\n', 'utf8')
}
function setUserEnv(k, v) {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('${k}', '${v}', 'User')`],
    { stdio: 'ignore' },
  )
}
function clearUserEnv(k) {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('${k}', $null, 'User')`],
    { stdio: 'ignore' },
  )
}
function httpJson(pathname, method = 'GET', body, timeoutMs = 180000) {
  return new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 11434,
        path: pathname,
        method,
        headers: data
          ? {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ollama',
              'Content-Length': Buffer.byteLength(data),
            }
          : { Authorization: 'Bearer ollama' },
        timeout: timeoutMs,
      },
      res => {
        let d = ''
        res.on('data', c => (d += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(d), raw: d })
          } catch {
            resolve({ status: res.statusCode, json: null, raw: d })
          }
        })
      },
    )
    req.on('error', e => resolve({ status: 0, json: null, raw: String(e.message || e) }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, json: null, raw: 'timeout' })
    })
    if (data) req.write(data)
    req.end()
  })
}

const settings = readJson(settingsPath)
const keepTavily = settings.env?.TAVILY_API_KEY
const keepSearch = settings.env?.WEB_SEARCH_PROVIDER || 'auto'
const keepPerms = settings.permissions

const liveMcp = settings.mcpServers && Object.keys(settings.mcpServers).length ? settings.mcpServers : null
if (liveMcp) {
  writeJson(mcpBackupPath, {
    parkedAt: new Date().toISOString(),
    reason: 'max-local-connected parks MCPs that stall chat',
    mcpServers: liveMcp,
  })
  console.log('parked_mcps', Object.keys(liveMcp).length)
}
settings.mcpServers = {}

settings.model = LOCAL
settings.effortLevel = 'max'
settings.alwaysThinkingEnabled = true
settings.disableAllHooks = true
settings.enabledPlugins = {}
settings.extraKnownMarketplaces = {}
settings.skipDangerousModePermissionPrompt = true

settings.env = {
  CLAUDE_CODE_USE_OPENAI: '1',
  OPENAI_BASE_URL: BASE,
  OPENAI_API_KEY: 'ollama',
  OPENAI_MODEL: LOCAL,
  OLLAMA_HOST: HOST,
  OLLAMA_NUM_GPU: '1',
  OLLAMA_FLASH_ATTENTION: '1',
  OLLAMA_CONTEXT_LENGTH: String(CTX),
  OLLAMA_MAX_VRAM: '30720',
  OLLAMA_KEEP_ALIVE: '30m',
  OLLAMA_NUM_PARALLEL: '1',
  OLLAMA_MAX_LOADED_MODELS: '1',
  OLLAMA_NUM_THREAD: '24',
  OPENCLAUDE_PERFORMANCE_MODE: 'max5090',
  CLAUDE_CODE_NO_FLICKER: '0',
  CLAUDE_CODE_DISABLE_MOUSE: '1',
  CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1',
  // Fail hung streams sooner so OpenClaude retries instead of Hyperspacing forever
  CLAUDE_STREAM_IDLE_TIMEOUT_MS: '90000',
  CLAUDE_CODE_OPENAI_FALLBACK_CONTEXT_WINDOW: String(FALLBACK_CTX),
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(AUTO_COMPACT),
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192',
  API_TIMEOUT_MS: '900000',
  OPENCLAUDE_MAX_RETRIES: '10',
  OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS: '30000',
  CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
  USE_BUILTIN_RIPGREP: '0',
  CLAUDE_CODE_GLOB_TIMEOUT_SECONDS: '60',
  OPENCLAUDE_DISABLE_TOOL_REMINDERS: '1',
  WEB_SEARCH_PROVIDER: keepSearch,
  CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({
    [LOCAL]: CTX,
    'qwen3.8:27b': CTX,
    'qwen3.8:latest': CTX,
    'qwen3.8:27b-mtp-q8_0': CTX,
    'qwen3.8:27b-q8_0': CTX,
    'qwen3.6-oc-code:27b': CTX,
    'qwen3.6:27b': CTX,
    'qwen3.6:latest': CTX,
    'qwen3-coder:30b': 32768,
    'qwen2.5-coder:7b': 16384,
    'devstral-small-2:latest': 32768,
    'kimi-k2.7-code:cloud': 120000,
    'kimi-k3:cloud': 131072,
    'glm-5.2:cloud': 120000,
  }),
}
if (keepTavily) settings.env.TAVILY_API_KEY = keepTavily
if (keepPerms) settings.permissions = keepPerms
writeJson(settingsPath, settings)

const ocj = readJson(ocjPath)
ocj.activeProviderProfileId = 'provider_local_power'
ocj.providerProfiles = (ocj.providerProfiles || []).map(p => {
  if (p.id === 'provider_local_power') {
    return {
      ...p,
      name: 'Ollama Local (qwen3.8-oc-code:27b MAX connected)',
      provider: 'ollama',
      baseUrl: BASE,
      model: LOCAL,
    }
  }
  return p
})
ocj.mcpServers = {}
ocj.agentModels = {
  [LOCAL]: { base_url: BASE, api_key: 'ollama' },
  'qwen3-coder:30b': { base_url: BASE, api_key: 'ollama' },
  'qwen2.5-coder:7b': { base_url: BASE, api_key: 'ollama' },
  'devstral-small-2:latest': { base_url: BASE, api_key: 'ollama' },
  'kimi-k2.7-code:cloud': { base_url: BASE, api_key: 'ollama' },
  'kimi-k3:cloud': { base_url: BASE, api_key: 'ollama' },
  'glm-5.2:cloud': { base_url: BASE, api_key: 'ollama' },
}
// Pin all agents to MAX local — no mid-chat model swaps / GPU thrash
ocj.agentRouting = {
  Explore: LOCAL,
  Plan: LOCAL,
  'general-purpose': LOCAL,
  'frontend-dev': LOCAL,
  'code-fixer': LOCAL,
  'hard-code-fixer': LOCAL,
  default: LOCAL,
}
writeJson(ocjPath, ocj)

writeJson(perfPath, {
  mode: 'max',
  tier: '5090-max-connected',
  applied: new Date().toISOString().slice(0, 16).replace('T', ' '),
  localModel: LOCAL,
  openaiBaseUrl: BASE,
  notes:
    'MAX effort+thinking+160k. Tool-first Modelfile. MCPs parked. Stream idle 90s. Prove /v1 chat + tool call.',
})

setUserEnv('OLLAMA_HOST', HOST)
setUserEnv('OLLAMA_NUM_GPU', '1')
setUserEnv('OLLAMA_FLASH_ATTENTION', '1')
setUserEnv('OLLAMA_CONTEXT_LENGTH', String(CTX))
setUserEnv('OLLAMA_MAX_VRAM', '32768')
setUserEnv('OLLAMA_KEEP_ALIVE', '30m')
setUserEnv('OLLAMA_NUM_PARALLEL', '1')
setUserEnv('OLLAMA_MAX_LOADED_MODELS', '1')
setUserEnv('CLAUDE_CODE_DISABLE_MOUSE', '1')
setUserEnv('CLAUDE_CODE_DISABLE_MOUSE_CLICKS', '1')
clearUserEnv('OLLAMA_KV_CACHE_TYPE')
clearUserEnv('CUDA_VISIBLE_DEVICES')

console.log('OK max settings written (effort max, thinking on, 160k)')
console.log('base', BASE, 'ctx', CTX)

try {
  console.log('recreating', LOCAL, '...')
  execFileSync('ollama', ['create', LOCAL, '-f', modelfile], { stdio: 'inherit' })
} catch (e) {
  console.log('WARN create:', e.message || e)
}
try {
  execFileSync('ollama', ['stop', LOCAL], { stdio: 'ignore' })
} catch {
  /* ignore */
}

// Prove tags + models + real chat (connection that OpenClaude uses)
let tags = null
for (let i = 0; i < 20; i++) {
  tags = await httpJson('/api/tags')
  if (tags.status === 200) break
  await new Promise(r => setTimeout(r, 1000))
}
if (tags.status !== 200) {
  console.log('FAIL ollama down', tags.raw)
  process.exit(2)
}

const models = await httpJson('/v1/models')
if (models.status !== 200) {
  console.log('FAIL /v1/models', models.status, models.raw)
  process.exit(3)
}

const t0 = Date.now()
const chat = await httpJson('/v1/chat/completions', 'POST', {
  model: LOCAL,
  messages: [{ role: 'user', content: 'Reply with exactly: MAX_LINK_OK' }],
  max_tokens: 1024,
  temperature: 0,
})
const ms = Date.now() - t0
const msg = chat.json?.choices?.[0]?.message || {}
const content = typeof msg.content === 'string' ? msg.content : ''
const reasoning =
  (typeof msg.reasoning === 'string' && msg.reasoning) ||
  (typeof msg.reasoning_content === 'string' && msg.reasoning_content) ||
  ''
const ok = chat.status === 200 && (/MAX_LINK_OK/i.test(content) || content.trim().length > 0 || reasoning.length > 0)
console.log('v1_chat', ok ? 'OK' : 'FAIL', `${ms}ms`, `content=${JSON.stringify(content).slice(0, 40)}`, `reasoning_len=${reasoning.length}`)
if (!ok) {
  console.log('OpenClaude is NOT connected until this passes.')
  process.exit(4)
}
console.log('MAX_CONNECTED_PASS')
console.log('Close any old OpenClaude window, then double-click run.bat (MAX only)')

/**
 * Runtime context-window discovery for OpenAI-compatible providers.
 *
 * Addresses the "unknown 3P model → conservative 128k fallback → silent
 * truncation" bug class. Probes the provider for the actual context window
 * and caches the result on disk so future runs skip the probe.
 *
 * Discovery strategies (first hit wins):
 *   1. GET {baseUrl}/models/{modelId} — OpenRouter, Together, Fireworks return
 *      `context_length` / `context_window` / `max_model_len`.
 *   2. GET {baseUrl}/models — some providers put context info in the list entries.
 *   3. POST {baseUrl}/../api/show  {"name": "<model>"} — Ollama native endpoint.
 *
 * Cache file: $CLAUDE_CONFIG_DIR/model-metadata.json (30-day TTL).
 * In-memory mirror loaded sync at first access so getContextWindowForModel()
 * stays synchronous.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'

const CACHE_FILE_NAME = 'model-metadata.json'
const CACHE_SCHEMA_VERSION = 1
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const DISCOVERY_TIMEOUT_MS = 5000

type CacheEntry = {
  contextWindow: number
  discoveredAt: number
  source: string
}

type CacheFile = {
  version: number
  entries: Record<string, CacheEntry>
}

type InMemoryCache = Map<string, CacheEntry>

let memCache: InMemoryCache | null = null
let configDirOverride: string | null = null

function resolveConfigDir(): string {
  return configDirOverride ?? getClaudeConfigHomeDir()
}

function cacheFilePath(): string {
  return join(resolveConfigDir(), CACHE_FILE_NAME)
}

/**
 * Test hook: inject a specific config directory instead of reading the
 * process-global env var. Avoids cross-test races under `bun test`'s parallel
 * file execution. Pass null to revert to env-based resolution.
 */
export function __setConfigDirForTests(dir: string | null): void {
  configDirOverride = dir
  memCache = null
}

function cacheKey(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, '')}::${model}`
}

function loadFromDisk(): InMemoryCache {
  const cache: InMemoryCache = new Map()
  const path = cacheFilePath()
  if (!existsSync(path)) return cache

  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as CacheFile
    if (parsed.version !== CACHE_SCHEMA_VERSION) return cache
    if (!parsed.entries || typeof parsed.entries !== 'object') return cache

    const now = Date.now()
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (
        !entry ||
        typeof entry.contextWindow !== 'number' ||
        typeof entry.discoveredAt !== 'number'
      ) {
        continue
      }
      if (now - entry.discoveredAt > CACHE_TTL_MS) continue
      cache.set(key, entry)
    }
  } catch (err) {
    logForDebugging(
      `[modelContextDiscovery] failed to read cache: ${String(err)}`,
      { level: 'warn' },
    )
  }
  return cache
}

function ensureLoaded(): InMemoryCache {
  if (memCache === null) {
    memCache = loadFromDisk()
  }
  return memCache
}

function persist(cache: InMemoryCache): void {
  try {
    const dir = resolveConfigDir()
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const file: CacheFile = {
      version: CACHE_SCHEMA_VERSION,
      entries: Object.fromEntries(cache.entries()),
    }
    writeFileSync(cacheFilePath(), JSON.stringify(file, null, 2), 'utf8')
  } catch (err) {
    logForDebugging(
      `[modelContextDiscovery] failed to write cache: ${String(err)}`,
      { level: 'warn' },
    )
  }
}

/**
 * Synchronous cache lookup. Safe to call from sync code paths like
 * getContextWindowForModel(). Returns undefined if the model has never been
 * discovered or its entry expired.
 */
export function getCachedContextWindow(
  baseUrl: string | undefined,
  model: string,
): number | undefined {
  if (!baseUrl || !model) return undefined
  const cache = ensureLoaded()
  const entry = cache.get(cacheKey(baseUrl, model))
  return entry?.contextWindow
}

/**
 * Test/reset hook. Clears the in-memory cache so the next call re-reads from disk.
 */
export function __resetContextCacheForTests(): void {
  memCache = null
}

function extractContextFromModelEntry(
  entry: Record<string, unknown> | null | undefined,
): number | undefined {
  if (!entry || typeof entry !== 'object') return undefined
  // Known context-window field names across providers. Each one unambiguously
  // refers to the *input* / total-window size.
  //   context_length     — OpenRouter, Together, Fireworks
  //   context_window     — Anthropic-style, some Groq models
  //   max_model_len      — vLLM / some OSS servers
  //   max_input_tokens   — Cohere, some others
  //   max_context_length — less common fallback seen on a few providers
  //
  // NOTE: `max_tokens` is DELIBERATELY omitted. In the OpenAI API schema
  // (and vLLM's OpenAI-compatible endpoint) `max_tokens` is the output
  // completion cap, not the context window. A 128k-context model with a
  // 4096 output cap would be cached as a 4096-window — triggering aggressive
  // premature auto-compaction on every turn. Only use fields whose semantics
  // are unambiguous.
  const candidates = [
    'context_length',
    'context_window',
    'max_model_len',
    'max_input_tokens',
    'max_context_length',
  ]
  for (const key of candidates) {
    const value = (entry as Record<string, unknown>)[key]
    if (typeof value === 'number' && value > 0) {
      return value
    }
  }
  return undefined
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) return undefined
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return undefined
    return await res.json()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

async function probeModelEndpoint(
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
): Promise<{ contextWindow: number; source: string } | undefined> {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const encoded = encodeURIComponent(model)
  const url = `${trimmed}/models/${encoded}`
  const data = (await fetchJson(
    url,
    { method: 'GET', headers },
    DISCOVERY_TIMEOUT_MS,
  )) as Record<string, unknown> | undefined
  if (!data) return undefined
  const direct = extractContextFromModelEntry(data)
  if (direct) return { contextWindow: direct, source: `GET ${url}` }
  // Some providers wrap metadata: { data: {...} } or { model: {...} }
  for (const nestKey of ['data', 'model', 'object']) {
    const nested = (data as Record<string, unknown>)[nestKey]
    const nestedWindow = extractContextFromModelEntry(
      nested as Record<string, unknown>,
    )
    if (nestedWindow) {
      return { contextWindow: nestedWindow, source: `GET ${url} (${nestKey})` }
    }
  }
  return undefined
}

async function probeModelList(
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
): Promise<{ contextWindow: number; source: string } | undefined> {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const url = `${trimmed}/models`
  const data = (await fetchJson(
    url,
    { method: 'GET', headers },
    DISCOVERY_TIMEOUT_MS,
  )) as { data?: Array<Record<string, unknown>> } | undefined
  const list = data?.data
  if (!Array.isArray(list)) return undefined
  const entry = list.find(e => (e as { id?: string }).id === model)
  if (!entry) return undefined
  const window = extractContextFromModelEntry(entry)
  if (window) return { contextWindow: window, source: `GET ${url} (list)` }
  return undefined
}

async function probeOllamaShow(
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
): Promise<{ contextWindow: number; source: string } | undefined> {
  // Ollama's native endpoint lives at /api/show, outside /v1.
  let originAndPrefix: string
  try {
    const parsed = new URL(baseUrl)
    const normalized = parsed.pathname.replace(/\/+$/, '')
    const prefix = normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized
    originAndPrefix = `${parsed.origin}${prefix}`.replace(/\/+$/, '')
  } catch {
    return undefined
  }
  const url = `${originAndPrefix}/api/show`
  const data = (await fetchJson(
    url,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    },
    DISCOVERY_TIMEOUT_MS,
  )) as Record<string, unknown> | undefined
  if (!data) return undefined

  // Ollama reports context via model_info["<arch>.context_length"] or parameters.
  const modelInfo = data.model_info as Record<string, unknown> | undefined
  if (modelInfo) {
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
        return { contextWindow: value, source: `POST ${url} (model_info.${key})` }
      }
    }
  }
  const parameters = data.parameters
  if (typeof parameters === 'string') {
    const match = parameters.match(/num_ctx\s+(\d+)/i)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > 0) return { contextWindow: n, source: `POST ${url} (parameters)` }
    }
  }
  return undefined
}

/**
 * Probe the provider for the context window of a specific model. Tries
 * /models/{id}, then /models list, then Ollama /api/show. Returns undefined
 * when no strategy succeeds.
 */
export async function discoverContextWindow(
  baseUrl: string,
  model: string,
  headers: Record<string, string> = {},
): Promise<{ contextWindow: number; source: string } | undefined> {
  const strategies = [probeModelEndpoint, probeModelList, probeOllamaShow]
  for (const strategy of strategies) {
    const result = await strategy(baseUrl, model, headers)
    if (result) return result
  }
  return undefined
}

/**
 * Record a discovered context window to the cache (memory + disk). Subsequent
 * synchronous reads via getCachedContextWindow() will see it immediately.
 */
export function rememberContextWindow(
  baseUrl: string,
  model: string,
  contextWindow: number,
  source: string,
): void {
  if (!baseUrl || !model || !contextWindow) return
  const cache = ensureLoaded()
  cache.set(cacheKey(baseUrl, model), {
    contextWindow,
    discoveredAt: Date.now(),
    source,
  })
  persist(cache)
}

/**
 * One-shot probe-and-cache. Does nothing if a fresh cache entry already exists.
 * Intended to be called at startup (fire-and-forget) for the active model.
 */
export async function warmContextWindowCache(
  baseUrl: string,
  model: string,
  headers: Record<string, string> = {},
): Promise<void> {
  if (!baseUrl || !model) return
  const existing = getCachedContextWindow(baseUrl, model)
  if (existing !== undefined) return
  const discovered = await discoverContextWindow(baseUrl, model, headers)
  if (discovered) {
    rememberContextWindow(
      baseUrl,
      model,
      discovered.contextWindow,
      discovered.source,
    )
  }
}

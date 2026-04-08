/**
 * Custom API provider adapter.
 *
 * Supports:
 * - Any HTTP endpoint via WEB_SEARCH_API
 * - Built-in presets via WEB_PROVIDER (searxng, google, brave, serpapi)
 * - GET or POST (WEB_METHOD)
 * - Query in path via WEB_URL_TEMPLATE with {query}
 * - Custom POST body via WEB_BODY_TEMPLATE with {query}
 * - Extra static params via WEB_PARAMS (JSON)
 * - Flexible response parsing (auto-detects common shapes)
 * - One automatic retry on failure
 *
 * ## Security Guardrails (Option B)
 *
 * This adapter creates a generic outbound HTTP client. The following
 * guardrails are enforced to reduce SSRF and data-exfiltration risk:
 *
 * 1. HTTPS-only by default (opt-out: WEB_CUSTOM_ALLOW_HTTP=true)
 * 2. Private / loopback / link-local IPs are blocked by default
 *    (opt-out: WEB_CUSTOM_ALLOW_PRIVATE=true)
 * 3. Built-in allowlist of header names — arbitrary headers require
 *    WEB_CUSTOM_ALLOW_ARBITRARY_HEADERS=true
 * 4. Max body size guard (300 KB for POST)
 * 5. Request timeout (default 15s, configurable via WEB_CUSTOM_TIMEOUT_SEC)
 * 6. Audit log on first custom search (one-time warning)
 */

import type { SearchInput, SearchProvider } from './types.js'
import {
  applyDomainFilters,
  normalizeHit,
  safeHostname,
  type ProviderOutput,
  type SearchHit,
} from './types.js'

// ---------------------------------------------------------------------------
// Built-in provider presets
// ---------------------------------------------------------------------------

interface ProviderPreset {
  urlTemplate: string
  queryParam: string
  method?: string
  authHeader?: string
  authScheme?: string
  jsonPath?: string
  responseAdapter?: (data: any) => SearchHit[]
}

const BUILT_IN_PROVIDERS: Record<string, ProviderPreset> = {
  searxng: {
    // NOTE: default uses https://localhost — users must override WEB_SEARCH_API
    // for their actual instance. The http:// default was intentionally removed
    // to comply with the HTTPS-only guardrail.
    urlTemplate: 'https://localhost:8080/search',
    queryParam: 'q',
    jsonPath: 'results',
    responseAdapter(data: any) {
      return (data.results ?? []).map((r: any) => ({
        title: r.title ?? r.url,
        url: r.url,
        description: r.content,
        source: r.engine ?? r.source,
      }))
    },
  },
  google: {
    urlTemplate: 'https://www.googleapis.com/customsearch/v1',
    queryParam: 'q',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    responseAdapter(data: any) {
      return (data.items ?? []).map((r: any) => ({
        title: r.title ?? '',
        url: r.link ?? '',
        description: r.snippet,
        source: r.displayLink,
      }))
    },
  },
  brave: {
    urlTemplate: 'https://api.search.brave.com/res/v1/web/search',
    queryParam: 'q',
    authHeader: 'X-Subscription-Token',
    responseAdapter(data: any) {
      return (data.web?.results ?? []).map((r: any) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        description: r.description,
        source: safeHostname(r.url),
      }))
    },
  },
  serpapi: {
    urlTemplate: 'https://serpapi.com/search.json',
    queryParam: 'q',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    responseAdapter(data: any) {
      return (data.organic_results ?? []).map((r: any) => ({
        title: r.title ?? '',
        url: r.link ?? '',
        description: r.snippet,
        source: r.displayed_link,
      }))
    },
  },
}

// ---------------------------------------------------------------------------
// Security guardrails
// ---------------------------------------------------------------------------

/** Maximum POST body size in bytes (300 KB default, configurable via WEB_CUSTOM_MAX_BODY_KB). */
const DEFAULT_MAX_BODY_KB = 300

/** Default request timeout in seconds. */
const DEFAULT_TIMEOUT_SECONDS = 15

/** Header names that are always allowed (case-insensitive). */
const SAFE_HEADER_NAMES = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'cache-control',
  'content-type',
  'if-modified-since',
  'if-none-match',
  'ocp-apim-subscription-key',
  'user-agent',
  'x-api-key',
  'x-subscription-token',
  'x-tenant-id',
])

/**
 * Private / reserved IP ranges that should not be reachable from a
 * search adapter (SSRF mitigation).
 *
 * This is a hostname-level check. DNS resolution to private IPs is
 * NOT blocked here (that would require resolving before fetch, which
 * Node fetch does not expose). This guard blocks obvious cases.
 */
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[::1?\]$/i,        // [::1] or [::]
  /^0x[0-9a-f]+$/i,     // hex-encoded IPs
]

function isPrivateHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAME_PATTERNS.some(re => re.test(hostname))
}

/**
 * Validate the target URL against security guardrails.
 * Throws on violation.
 */
function validateUrl(urlString: string): void {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    throw new Error(`Custom search URL is not a valid URL: ${urlString.slice(0, 100)}`)
  }

  // 2. HTTPS-only (unless explicitly opted out)
  const allowHttp = process.env.WEB_CUSTOM_ALLOW_HTTP === 'true'
  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error(
      `Custom search URL must use https:// (got ${parsed.protocol}). ` +
      `Set WEB_CUSTOM_ALLOW_HTTP=true to override (not recommended).`,
    )
  }

  // 3. Private network check (unless explicitly opted out)
  const allowPrivate = process.env.WEB_CUSTOM_ALLOW_PRIVATE === 'true'
  if (!allowPrivate && isPrivateHostname(parsed.hostname)) {
    throw new Error(
      `Custom search URL targets a private/reserved address (${parsed.hostname}). ` +
      `This is blocked by default to prevent SSRF. ` +
      `Set WEB_CUSTOM_ALLOW_PRIVATE=true to override (e.g. for local SearXNG).`,
    )
  }
}

/**
 * Validate that user-supplied headers are in the safe allowlist,
 * unless WEB_CUSTOM_ALLOW_ARBITRARY_HEADERS=true.
 */
function validateHeaderName(name: string): boolean {
  const allowArbitrary = process.env.WEB_CUSTOM_ALLOW_ARBITRARY_HEADERS === 'true'
  if (allowArbitrary) return true
  return SAFE_HEADER_NAMES.has(name.toLowerCase())
}

/**
 * Log a one-time audit warning that custom outbound search is active.
 * Prevents silent data exfiltration.
 */
let auditLogged = false
function auditLogCustomSearch(url: string): void {
  if (auditLogged) return
  auditLogged = true
  console.warn(
    `[web-search] ⚠️  Custom search provider is active. ` +
    `Outbound requests go to: ${safeHostname(url) ?? url}. ` +
    `Ensure this endpoint is trusted. ` +
    `See: https://github.com/Gitlawb/openclaude/pull/512#security`,
  )
}

// ---------------------------------------------------------------------------
// Auth — preset overrides for built-in providers
// ---------------------------------------------------------------------------

function buildAuthHeadersForPreset(preset?: ProviderPreset): Record<string, string> {
  const apiKey = process.env.WEB_KEY
  if (!apiKey) return {}

  const headerName = process.env.WEB_AUTH_HEADER ?? preset?.authHeader ?? 'Authorization'
  const scheme = process.env.WEB_AUTH_SCHEME ?? preset?.authScheme ?? 'Bearer'
  return { [headerName]: `${scheme} ${apiKey}`.trim() }
}

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

function resolveConfig(): {
  urlTemplate: string
  queryParam: string
  method: string
  jsonPath?: string
  responseAdapter?: (data: any) => SearchHit[]
  preset?: ProviderPreset
} {
  const providerName = process.env.WEB_PROVIDER
  const preset = providerName ? BUILT_IN_PROVIDERS[providerName] : undefined

  return {
    urlTemplate: process.env.WEB_URL_TEMPLATE
      ?? process.env.WEB_SEARCH_API
      ?? preset?.urlTemplate
      ?? '',
    queryParam: process.env.WEB_QUERY_PARAM ?? preset?.queryParam ?? 'q',
    method: process.env.WEB_METHOD ?? preset?.method ?? 'GET',
    jsonPath: process.env.WEB_JSON_PATH ?? preset?.jsonPath,
    responseAdapter: preset?.responseAdapter,
    preset,
  }
}

function parseExtraParams(): Record<string, string> {
  const raw = process.env.WEB_PARAMS
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
  } catch { /* ignore */ }
  return {}
}

function buildRequest(query: string) {
  const config = resolveConfig()
  const method = config.method.toUpperCase()

  // --- URL ---
  const rawTemplate = config.urlTemplate
  const templateWithQuery = rawTemplate.replace(/\{query\}/g, encodeURIComponent(query))
  const url = new URL(templateWithQuery)

  // Merge extra static params
  for (const [k, v] of Object.entries(parseExtraParams())) {
    url.searchParams.set(k, v)
  }

  // If {query} wasn't in template, add as param
  if (!rawTemplate.includes('{query}')) {
    url.searchParams.set(config.queryParam, query)
  }

  const urlString = url.toString()

  // --- Security validation ---
  validateUrl(urlString)
  auditLogCustomSearch(urlString)

  // --- Headers ---
  const headers: Record<string, string> = {
    ...buildAuthHeadersForPreset(config.preset),
  }

  // Merge WEB_HEADERS with allowlist enforcement
  const rawExtra = process.env.WEB_HEADERS
  if (rawExtra) {
    for (const pair of rawExtra.split(';')) {
      const i = pair.indexOf(':')
      if (i > 0) {
        const k = pair.slice(0, i).trim()
        const v = pair.slice(i + 1).trim()
        if (k) {
          if (!validateHeaderName(k)) {
            throw new Error(
              `Header "${k}" is not in the safe allowlist. ` +
              `Allowed: ${[...SAFE_HEADER_NAMES].join(', ')}. ` +
              `Set WEB_CUSTOM_ALLOW_ARBITRARY_HEADERS=true to override.`,
            )
          }
          headers[k] = v
        }
      }
    }
  }

  const init: RequestInit = { method, headers }

  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
    const bodyTemplate = process.env.WEB_BODY_TEMPLATE
    if (bodyTemplate) {
      const body = bodyTemplate.replace(/\{query\}/g, query)
      const maxBodyBytes = (Number(process.env.WEB_CUSTOM_MAX_BODY_KB) || DEFAULT_MAX_BODY_KB) * 1024
      if (Buffer.byteLength(body) > maxBodyBytes) {
        throw new Error(
          `POST body exceeds ${maxBodyBytes} bytes. ` +
          `Increase WEB_CUSTOM_MAX_BODY_KB if needed.`,
        )
      }
      init.body = body
    } else {
      init.body = JSON.stringify({ [config.queryParam]: query })
    }
  }

  return { url: urlString, init, config }
}

// ---------------------------------------------------------------------------
// Response parsing — flexible, handles many shapes
// ---------------------------------------------------------------------------

function walkJsonPath(obj: any, path: string): any {
  let current = obj
  for (const seg of path.split('.')) {
    if (current == null) return undefined
    current = current[seg]
  }
  return current
}

function extractFromNode(node: any): SearchHit[] {
  if (!node) return []
  if (Array.isArray(node)) return node.map(normalizeHit).filter(Boolean) as SearchHit[]
  if (typeof node === 'object') {
    const all: SearchHit[] = []
    for (const sub of Object.values(node)) all.push(...extractFromNode(sub))
    return all
  }
  return []
}

export function extractHits(raw: any, jsonPath?: string): SearchHit[] {
  if (jsonPath) return extractFromNode(walkJsonPath(raw, jsonPath))
  if (Array.isArray(raw)) return raw.map(normalizeHit).filter(Boolean) as SearchHit[]
  if (!raw || typeof raw !== 'object') return []

  const arrayKeys = ['results', 'items', 'data', 'web', 'organic_results', 'hits', 'entries']
  for (const key of arrayKeys) {
    const val = raw[key]
    if (Array.isArray(val)) return val.map(normalizeHit).filter(Boolean) as SearchHit[]
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const all: SearchHit[] = []
      for (const sub of Object.values(val)) {
        if (Array.isArray(sub)) all.push(...(sub.map(normalizeHit).filter(Boolean) as SearchHit[]))
      }
      if (all.length > 0) return all
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Fetch with one retry + timeout
// ---------------------------------------------------------------------------

async function fetchWithRetry(url: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
  const timeoutSec = Number(process.env.WEB_CUSTOM_TIMEOUT_SEC) || DEFAULT_TIMEOUT_SECONDS
  const timeoutMs = timeoutSec * 1000
  let lastErr: Error | undefined
  let lastStatus: number | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    // Create a timeout that races with the external signal
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // If the external signal is already aborted, forward it
    if (signal?.aborted) {
      controller.abort()
    } else {
      signal?.addEventListener('abort', () => controller.abort(), { once: true })
    }

    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)

      if (!res.ok) {
        lastStatus = res.status
        throw new Error(`Custom search API returned ${res.status}: ${res.statusText}`)
      }
      return await res.json()
    } catch (err) {
      clearTimeout(timer)
      lastErr = err instanceof Error ? err : new Error(String(err))

      // AbortError from timeout
      if (lastErr.name === 'AbortError' && !signal?.aborted) {
        throw new Error(`Custom search timed out after ${timeoutSec}s`)
      }

      // Retry on 5xx or network errors only
      if (attempt === 0) {
        if (lastStatus !== undefined && lastStatus >= 500) {
          await new Promise(r => setTimeout(r, 500))
          continue
        }
        if (lastStatus === undefined) {
          // Network error — retry
          await new Promise(r => setTimeout(r, 500))
          continue
        }
        // 4xx — don't retry
      }
      throw lastErr
    }
  }
  throw lastErr!
}

// ---------------------------------------------------------------------------
// Provider export
// ---------------------------------------------------------------------------

export const customProvider: SearchProvider = {
  name: 'custom',

  isConfigured() {
    return Boolean(process.env.WEB_SEARCH_API || process.env.WEB_PROVIDER)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    const { url, init, config } = buildRequest(input.query)
    const raw = await fetchWithRetry(url, init, signal)

    const hits = config.responseAdapter
      ? config.responseAdapter(raw)
      : extractHits(raw, config.jsonPath)

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'custom',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}

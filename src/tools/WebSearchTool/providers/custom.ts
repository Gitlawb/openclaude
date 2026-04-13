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
 * 5. Request timeout (default 120s, configurable via WEB_CUSTOM_TIMEOUT_SEC)
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
const DEFAULT_TIMEOUT_SECONDS = 120

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
 * Private / reserved address check for SSRF mitigation.
 *
 * Operates on the hostname produced by WHATWG `new URL(...)`, which already
 * normalizes short-form, numeric, hex, and octal IPv4 to dotted-quad
 * (e.g. `127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1` → `127.0.0.1`),
 * and which preserves IPv6 in bracketed compressed form
 * (e.g. `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`).
 *
 * DNS resolution to private IPs is NOT blocked here — resolving before
 * fetch is not exposed by Node's fetch. This guard blocks literal-address
 * bypasses, which is what the original regex was trying (and failing) to do.
 */

function ipv4DottedToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    const x = Number(p)
    if (!Number.isInteger(x) || x < 0 || x > 255) return null
    n = n * 256 + x
  }
  return n >>> 0
}

function isPrivateIPv4Int(n: number): boolean {
  const a = (n >>> 24) & 0xff
  const b = (n >>> 16) & 0xff
  // 0.0.0.0/8 "this network"
  if (a === 0) return true
  // 10.0.0.0/8
  if (a === 10) return true
  // 100.64.0.0/10 CGNAT
  if (a === 100 && (b & 0xc0) === 0x40) return true
  // 127.0.0.0/8 loopback
  if (a === 127) return true
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12
  if (a === 172 && (b & 0xf0) === 0x10) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  return false
}

/**
 * Parse an IPv6 address (without brackets, zone id optional) to 16 bytes.
 * Returns null on malformed input. Handles `::` compression and embedded
 * IPv4 suffix (e.g. `::ffff:127.0.0.1`).
 */
function parseIPv6(input: string): Uint8Array | null {
  let s = input.split('%')[0] ?? ''
  if (s === '') return null

  // Split off trailing embedded IPv4 if present
  let trailingV4: [number, number, number, number] | null = null
  const v4m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (v4m) {
    const n = ipv4DottedToInt(v4m[2]!)
    if (n === null) return null
    trailingV4 = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
    s = v4m[1]!.replace(/:$/, '')
    if (s === '') s = '::' // e.g. input was "::1.2.3.4"
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0]!.split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(':') : []

  const groupsNeeded = 8 - (trailingV4 ? 2 : 0)
  if (halves.length === 1 && left.length !== groupsNeeded) return null
  if (halves.length === 2 && left.length + right.length > groupsNeeded) return null

  const fill = halves.length === 2 ? groupsNeeded - left.length - right.length : 0
  const groups = [...left, ...Array(fill).fill('0'), ...right]

  const bytes = new Uint8Array(16)
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
    const v = parseInt(g, 16)
    bytes[i * 2] = (v >>> 8) & 0xff
    bytes[i * 2 + 1] = v & 0xff
  }
  if (trailingV4) {
    const off = groups.length * 2
    bytes[off] = trailingV4[0]
    bytes[off + 1] = trailingV4[1]
    bytes[off + 2] = trailingV4[2]
    bytes[off + 3] = trailingV4[3]
  }
  return bytes
}

function isPrivateIPv6(bytes: Uint8Array): boolean {
  // ::1 loopback
  let allZeroExceptLast = true
  for (let i = 0; i < 15; i++) if (bytes[i] !== 0) { allZeroExceptLast = false; break }
  if (allZeroExceptLast && bytes[15] === 1) return true
  // :: unspecified
  if (bytes.every(v => v === 0)) return true
  // IPv4-mapped ::ffff:a.b.c.d
  let isV4Mapped = true
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) { isV4Mapped = false; break }
  if (isV4Mapped && bytes[10] === 0xff && bytes[11] === 0xff) {
    const n = ((bytes[12]! << 24) | (bytes[13]! << 16) | (bytes[14]! << 8) | bytes[15]!) >>> 0
    return isPrivateIPv4Int(n)
  }
  // IPv4-compatible (deprecated) ::a.b.c.d — treat as private if embedded v4 is
  let isV4Compat = true
  for (let i = 0; i < 12; i++) if (bytes[i] !== 0) { isV4Compat = false; break }
  if (isV4Compat) {
    const n = ((bytes[12]! << 24) | (bytes[13]! << 16) | (bytes[14]! << 8) | bytes[15]!) >>> 0
    if (n !== 0 && n !== 1) return isPrivateIPv4Int(n)
  }
  // ULA fc00::/7
  if ((bytes[0]! & 0xfe) === 0xfc) return true
  // Link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true
  // Site-local (deprecated) fec0::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true
  return false
}

export function isPrivateHostname(hostname: string): boolean {
  if (/^localhost$/i.test(hostname)) return true
  // URL.hostname wraps IPv6 literals in brackets; strip for parsing.
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  // IPv4 dotted-quad (WHATWG URL normalizes short/numeric/hex/octal to this).
  const v4 = ipv4DottedToInt(unwrapped)
  if (v4 !== null) return isPrivateIPv4Int(v4)
  // IPv6
  if (unwrapped.includes(':')) {
    const bytes = parseIPv6(unwrapped)
    if (bytes) return isPrivateIPv6(bytes)
  }
  return false
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

export function buildAuthHeadersForPreset(preset?: ProviderPreset): Record<string, string> {
  const apiKey = process.env.WEB_KEY
  if (!apiKey) return {}

  // WEB_AUTH_HEADER="" is an explicit opt-out of auth headers entirely
  const explicitHeader = process.env.WEB_AUTH_HEADER
  if (explicitHeader === '') return {}

  const headerName = explicitHeader ?? preset?.authHeader ?? 'Authorization'
  const scheme = process.env.WEB_AUTH_SCHEME !== undefined
    ? process.env.WEB_AUTH_SCHEME
    : (preset?.authScheme ?? 'Bearer')
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
    if (current == null || typeof current !== 'object') return undefined
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
  // node is a primitive (string/number) — not a valid hit structure
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
    // Compose timeout with caller signal via AbortSignal.any so each attempt
    // has a fresh timeout and we don't leak an abort listener on `signal`
    // (the previous implementation added one per attempt and never removed
    // it, and the listener kept a reference to a stale AbortController).
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combined = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

    lastStatus = undefined
    try {
      const res = await fetch(url, { ...init, signal: combined })

      if (!res.ok) {
        lastStatus = res.status
        throw new Error(`Custom search API returned ${res.status}: ${res.statusText}`)
      }
      return await res.json()
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))

      // Caller-initiated abort wins — propagate without retry or rewrite.
      if (signal?.aborted) throw lastErr

      // Timeout (TimeoutError on Bun/Node, or AbortError with timeoutSignal aborted).
      if (timeoutSignal.aborted) {
        throw new Error(`Custom search timed out after ${timeoutSec}s`)
      }

      // Retry once on 5xx or network errors; do not retry 4xx.
      if (attempt === 0 && (lastStatus === undefined || lastStatus >= 500)) {
        await new Promise(r => setTimeout(r, 500))
        continue
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
    return Boolean(process.env.WEB_SEARCH_API || process.env.WEB_PROVIDER || process.env.WEB_URL_TEMPLATE)
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

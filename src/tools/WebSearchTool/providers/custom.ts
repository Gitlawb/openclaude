/**
 * Custom API provider adapter.
 *
 * Supports:
 * - Any HTTP endpoint via WEB_SEARCH_API
 * - Built-in presets via WEB_PROVIDER (searxng, google, brave, serpapi)
 * - GET or POST (WEB_METHOD)
 * - Query in URL path via WEB_URL_TEMPLATE with {query}
 * - Custom POST body via WEB_BODY_TEMPLATE with {query}
 * - Extra static params via WEB_PARAMS (JSON)
 * - Flexible response parsing (auto-detects common shapes)
 * - One automatic retry on failure
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
    urlTemplate: 'http://localhost:8080/search',
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
// Auth — preset overrides for built-in providers
// ---------------------------------------------------------------------------

function buildAuthHeadersForPreset(preset?: ProviderPreset): Record<string, string> {
  const apiKey = process.env.WEB_KEY
  if (!apiKey) return {}

  // If the preset defines its own auth header/scheme, use those
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
  // WEB_URL_TEMPLATE supports {query} in path, e.g. /search/{query}
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

  // --- Headers ---
  const headers: Record<string, string> = {
    ...buildAuthHeadersForPreset(config.preset),
  }

  // Merge WEB_HEADERS ("Name: value; Name2: value2")
  const rawExtra = process.env.WEB_HEADERS
  if (rawExtra) {
    for (const pair of rawExtra.split(';')) {
      const i = pair.indexOf(':')
      if (i > 0) {
        const k = pair.slice(0, i).trim()
        const v = pair.slice(i + 1).trim()
        if (k) headers[k] = v
      }
    }
  }

  const init: RequestInit = { method, headers }

  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
    const bodyTemplate = process.env.WEB_BODY_TEMPLATE
    if (bodyTemplate) {
      init.body = bodyTemplate.replace(/\{query\}/g, query)
    } else {
      init.body = JSON.stringify({ [config.queryParam]: query })
    }
  }

  return { url: url.toString(), init, config }
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
  // 1. Explicit json path
  if (jsonPath) return extractFromNode(walkJsonPath(raw, jsonPath))

  // 2. Bare array
  if (Array.isArray(raw)) return raw.map(normalizeHit).filter(Boolean) as SearchHit[]

  if (!raw || typeof raw !== 'object') return []

  // 3. Common keys — check flat arrays first, then nested maps
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
// Fetch with one retry
// ---------------------------------------------------------------------------

async function fetchWithRetry(url: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
  let lastErr: Error | undefined
  let lastStatus: number | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal })
      if (!res.ok) {
        lastStatus = res.status
        throw new Error(`Custom search API returned ${res.status}: ${res.statusText}`)
      }
      return await res.json()
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      // Only retry on server errors (5xx) or network failures — never retry 4xx
      if (attempt === 0 && lastStatus !== undefined && lastStatus >= 500) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      if (attempt === 0 && lastStatus === undefined) {
        // Network error (no status) — retry
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

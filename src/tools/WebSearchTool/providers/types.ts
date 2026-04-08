/**
 * Search provider adapter types.
 *
 * Every backend implements SearchProvider. WebSearchTool.selectProvider()
 * picks the right one; shared logic (domain filtering, snippet formatting,
 * result-block construction) lives in the tool layer, not in adapters.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SearchHit {
  title: string
  url: string
  description?: string
  source?: string
}

export interface SearchInput {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

export interface ProviderOutput {
  hits: SearchHit[]
  /** Provider name for logging / tool_use_id */
  providerName: string
  /** Duration of the provider call in seconds */
  durationSeconds: number
}

export interface SearchProvider {
  /** Human-readable label (used in tool_use_id, logs) */
  readonly name: string
  /** Returns true when the env vars / config needed for this provider are present */
  isConfigured(): boolean
  /** Perform the search. Throw on unrecoverable errors. */
  search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput>
}

// ---------------------------------------------------------------------------
// Flexible response parsing helpers
// ---------------------------------------------------------------------------

const TITLE_KEYS = ['title', 'headline', 'name', 'heading'] as const
const URL_KEYS = ['url', 'link', 'href', 'uri', 'permalink'] as const
const DESC_KEYS = [
  'description', 'snippet', 'content', 'preview', 'summary', 'text', 'body',
] as const
const SOURCE_KEYS = [
  'source', 'domain', 'displayLink', 'displayed_link', 'engine',
] as const

function firstMatch(obj: any, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    if (typeof obj?.[k] === 'string' && obj[k]) return obj[k]
  }
  return undefined
}

/** Extract a SearchHit from any object shape using well-known field aliases. */
export function normalizeHit(raw: any): SearchHit | null {
  if (!raw || typeof raw !== 'object') return null
  const title = firstMatch(raw, TITLE_KEYS)
  const url = firstMatch(raw, URL_KEYS)
  if (!title && !url) return null
  const hit: SearchHit = { title: title ?? url!, url: url ?? title! }
  const desc = firstMatch(raw, DESC_KEYS)
  const source = firstMatch(raw, SOURCE_KEYS)
  if (desc) hit.description = desc
  if (source) hit.source = source
  return hit
}

// ---------------------------------------------------------------------------
// Domain filtering — shared across ALL providers
// ---------------------------------------------------------------------------

export function applyDomainFilters(
  hits: SearchHit[],
  input: SearchInput,
): SearchHit[] {
  let out = hits
  if (input.blocked_domains?.length) {
    out = out.filter(h => {
      try { return !input.blocked_domains!.some(d => new URL(h.url).hostname.endsWith(d)) }
      catch { return false }
    })
  }
  if (input.allowed_domains?.length) {
    out = out.filter(h => {
      try { return input.allowed_domains!.some(d => new URL(h.url).hostname.endsWith(d)) }
      catch { return false }
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Build auth headers from WEB_KEY + WEB_AUTH_HEADER + WEB_AUTH_SCHEME */
export function buildAuthHeaders(): Record<string, string> {
  const apiKey = process.env.WEB_KEY
  if (!apiKey) return {}
  const headerName = process.env.WEB_AUTH_HEADER ?? 'Authorization'
  const scheme = process.env.WEB_AUTH_SCHEME ?? 'Bearer'
  return { [headerName]: `${scheme} ${apiKey}`.trim() }
}

/** Parse WEB_HEADERS="Name: val; Name2: val2" into an object */
export function parseExtraHeaders(): Record<string, string> {
  const raw = process.env.WEB_HEADERS
  if (!raw) return {}
  const h: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const i = pair.indexOf(':')
    if (i > 0) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (k) h[k] = v }
  }
  return h
}

/** Merge all auth + extra headers */
export function buildAllHeaders(): Record<string, string> {
  return { ...buildAuthHeaders(), ...parseExtraHeaders() }
}

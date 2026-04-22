/**
 * Cross-provider cache usage normalizer for Phase 1 observability.
 *
 * Two layers of extraction, because the shim layer (openaiShim/codexShim)
 * already converts raw provider usage to Anthropic-shape on the way in:
 *
 *   1. `extractCacheReadFromRawUsage` — consumes RAW provider usage, used
 *      from inside the shims where each provider's native field names are
 *      still visible. Single source of truth for "where is the cached-
 *      tokens count on provider X".
 *   2. `extractCacheMetrics` — consumes POST-shim Anthropic-shape usage,
 *      which is what every downstream caller (cost-tracker, REPL display,
 *      /cache-stats) actually sees. Uses the `provider` argument only to
 *      decide whether the metric is `supported` (Copilot vanilla, Ollama
 *      get N/A rather than a fabricated 0%).
 *
 * Design rationale:
 *   - Pure functions, no globals: callers pass the provider explicitly so
 *     that tests, background agents and teammates get consistent results
 *     even when the process-level provider flag differs.
 *   - Honest N/A: Copilot (non-Claude) and Ollama do not expose cache data
 *     at all. Returning 0 would lie and corrupt aggregate hit-rate, so we
 *     return `supported: false` and let the display decide how to render.
 *   - `hitRate` is null whenever there is no input to compare against
 *     (0 read + 0 created). A 0% hit rate would suggest "cold" when in
 *     reality the turn had no cacheable content to begin with.
 *   - After normalization, `read + created ≤ total`, with any remainder
 *     being fresh (non-cacheable) input tokens. The shim enforces this
 *     invariant by subtracting cached from raw prompt_tokens so that
 *     post-shim `input_tokens` is always "fresh only" per Anthropic
 *     convention.
 *
 * Raw provider shapes (as of 2026-04):
 *   - Anthropic:        usage.cache_read_input_tokens,
 *                       usage.cache_creation_input_tokens,
 *                       usage.input_tokens (fresh only)
 *   - OpenAI / Codex:   usage.input_tokens_details?.cached_tokens
 *                       usage.prompt_tokens_details?.cached_tokens,
 *                       usage.prompt_tokens (includes cached)
 *   - Kimi / Moonshot:  usage.cached_tokens (top level), usage.prompt_tokens
 *   - DeepSeek:         usage.prompt_cache_hit_tokens,
 *                       usage.prompt_cache_miss_tokens
 *   - Gemini:           usage.cached_content_token_count,
 *                       usage.prompt_token_count
 *   - Copilot (non-Claude) / Ollama: not reported → supported=false
 */
import type { APIProvider } from '../../utils/model/providers.js'

/** Providers for which we know how to read cache fields. */
export type CacheAwareProvider =
  | 'anthropic'
  | 'openai'
  | 'codex'
  | 'kimi'
  | 'deepseek'
  | 'gemini'
  | 'ollama'
  // Generic local / self-hosted OpenAI-compatible endpoints (vLLM,
  // LM Studio, LocalAI, text-generation-webui, custom internal servers
  // on RFC1918 addresses, reserved TLDs like .local / .internal, etc.).
  // Distinct from `ollama` because Ollama might someday add cache
  // reporting; keeping the buckets separate means that change stays
  // local to one branch.
  | 'self-hosted'
  | 'copilot'
  | 'copilot-claude'

/** Unified cache metrics for one API response. */
export type CacheMetrics = {
  /** Tokens served from cache on this request. */
  read: number
  /**
   * Tokens written INTO the cache on this request. Only non-zero for
   * providers with explicit caching (Anthropic family).
   */
  created: number
  /**
   * Total input tokens the request is measured against, computed uniformly
   * as `fresh + read + created` after the shim normalizes every provider
   * to the Anthropic convention. Used as the denominator for hit-rate.
   */
  total: number
  /**
   * `read / total`, or null when the denominator is zero or the provider
   * doesn't support cache reporting.
   */
  hitRate: number | null
  /**
   * False for providers that do not expose cache data at all. Callers
   * should render "N/A" instead of "0%" in that case.
   */
  supported: boolean
}

/** Empty reference returned for unsupported providers — copy elision. */
const UNSUPPORTED: CacheMetrics = {
  read: 0,
  created: 0,
  total: 0,
  hitRate: null,
  supported: false,
}

/** Raw usage shape — intentionally permissive, each provider picks its fields. */
export type RawUsage = Record<string, unknown> | null | undefined

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function pickPath(usage: RawUsage, path: string[]): unknown {
  let cur: unknown = usage
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * Returns true when the URL points at a private, loopback, link-local,
 * CGNAT, or reserved-TLD host — anywhere a self-hosted OpenAI-compatible
 * server is likely running (vLLM, LM Studio, LocalAI, Ollama on a
 * non-default port, text-generation-webui, corporate internal proxies).
 *
 * WHY a dedicated helper (vs the old substring match):
 *   The previous check only looked for `localhost` / `127.0.0.1` /
 *   `:11434` / `:1234` as substrings. That misclassified real setups:
 *   a vLLM server at `http://192.168.1.50:8000/v1` or an internal
 *   endpoint at `http://llm.internal:5000/v1` fell through the `openai`
 *   branch, got marked as cache-capable, and `/cache-stats` reported
 *   `[Cache: cold]` — making users think their cache was broken when
 *   in reality the provider simply doesn't report cache fields.
 *
 * Intentionally narrower than WebSearchTool's `isPrivateHostname`
 * (which defends against SSRF bypass vectors like IPv4-mapped IPv6
 * and octal-encoded IPs). We only need to classify a reporting bucket,
 * not enforce a security boundary — a false negative here at worst
 * shows `[Cache: cold]` instead of `[Cache: N/A]`.
 *
 * See cacheMetrics.test.ts for the cases this function is contracted to
 * return true/false for.
 */
function isLocalOrPrivateUrl(url: string): boolean {
  if (!url) return false
  let hostname = ''
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    // Fall through to the substring fallback below.
  }
  // WHATWG URL accepts `localhost:8000` (treats `localhost:` as scheme,
  // leaving hostname empty). Treat empty-hostname parses the same as a
  // parse failure so we still catch the obvious cases with substring.
  if (!hostname) {
    const lower = url.toLowerCase()
    return (
      lower.includes('localhost') ||
      lower.includes('127.0.0.1') ||
      lower.includes('::1')
    )
  }
  // Unwrap IPv6 literal brackets that URL.hostname leaves attached.
  const h = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  // Literal localhost alias.
  if (h === 'localhost') return true
  // Reserved TLDs per RFC 6761, RFC 6762 (mDNS), RFC 8375 (home network).
  // These are guaranteed never to resolve to public infrastructure.
  if (
    h === 'local' ||
    h.endsWith('.local') ||
    h.endsWith('.lan') ||
    h.endsWith('.internal') ||
    h.endsWith('.intranet') ||
    h.endsWith('.home.arpa')
  ) {
    return true
  }
  // IPv4 private and reserved ranges. URL.hostname normalizes short /
  // hex / octal IPv4 representations to dotted-quad, so a simple regex
  // works for the display-classification use case.
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    // 10.0.0.0/8 (RFC 1918)
    if (a === 10) return true
    // 172.16.0.0/12 (RFC 1918)
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16 (RFC 1918)
    if (a === 192 && b === 168) return true
    // 127.0.0.0/8 loopback
    if (a === 127) return true
    // 169.254.0.0/16 link-local (AWS/GCP metadata, stateless autoconf)
    if (a === 169 && b === 254) return true
    // 100.64.0.0/10 CGNAT (Tailscale, carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  // IPv6 common local/private ranges — narrow by design.
  if (h === '::1' || h === '::') return true
  // fe80::/10 link-local and fc00::/7 unique-local (ULA). A colon is
  // required in the match so `fc` / `fd` don't over-match real
  // hostnames like `fc-api.example.com` or `fd-hosted.com`. URL.hostname
  // strips brackets, so an IPv6 literal like `fc00::1` shows up here as
  // `fc00::1` — still contains the colon.
  if (
    h.startsWith('fe80:') ||
    /^fc[0-9a-f]{0,2}:/.test(h) ||
    /^fd[0-9a-f]{0,2}:/.test(h)
  ) {
    return true
  }
  return false
}

/**
 * Map the canonical APIProvider enum (+ environment hints) into a
 * cache-capability bucket. We separate `copilot` (no cache) from
 * `copilot-claude` (Anthropic shim via Copilot with explicit cache)
 * because the two behave very differently even under the same provider
 * flag — see `isGithubNativeAnthropicMode` in utils/model/providers.ts.
 *
 * Order of OpenAI-compatible checks matters:
 *   1. Private / self-hosted URL — no cache fields regardless of vendor.
 *   2. Vendor-specific hosted providers (Kimi, DeepSeek) — known cache
 *      shapes that deserve their own normalization branch.
 *   3. Plain OpenAI — default bucket.
 * Doing hosted-vendor matching before self-hosted detection would let a
 * private-IP endpoint with "deepseek" in the URL fall into the wrong
 * branch; doing self-hosted last would let a `.internal` URL with
 * "openai" in its path be misclassified. The current order is correct
 * for both pathological cases.
 */
export function resolveCacheProvider(
  provider: APIProvider,
  hints?: { githubNativeAnthropic?: boolean; openAiBaseUrl?: string },
): CacheAwareProvider {
  if (provider === 'github') {
    return hints?.githubNativeAnthropic ? 'copilot-claude' : 'copilot'
  }
  if (provider === 'firstParty' || provider === 'bedrock' || provider === 'vertex' || provider === 'foundry') {
    return 'anthropic'
  }
  if (provider === 'gemini') return 'gemini'
  if (provider === 'codex') return 'codex'
  if (provider === 'openai') {
    const url = hints?.openAiBaseUrl ?? ''
    // Self-hosted / private-network endpoint — detect first so a vLLM
    // server on 192.168.x.x or a .internal DNS entry is honestly
    // classified as no-cache, not misreported as plain OpenAI.
    if (isLocalOrPrivateUrl(url)) return 'self-hosted'
    const lower = url.toLowerCase()
    // The :11434 port still signals Ollama specifically (default port).
    // If someone runs Ollama on a private IP:11434 we picked it up above
    // as 'self-hosted'; only a public-looking URL with :11434 lands here.
    if (lower.includes(':11434')) return 'ollama'
    if (lower.includes('moonshot') || lower.includes('kimi')) return 'kimi'
    if (lower.includes('deepseek')) return 'deepseek'
    return 'openai'
  }
  // nvidia-nim, minimax, mistral share the OpenAI Chat Completions convention
  // for cache reporting (prompt_tokens_details.cached_tokens). Treat them as
  // 'openai' for normalization purposes — if the provider doesn't emit the
  // field we simply get zeros, and hitRate stays null via the 0-guard below.
  return 'openai'
}

/**
 * Read the cached-tokens count from a RAW provider usage object, handling
 * every shape we know about. Callers are the shim layer (openaiShim,
 * codexShim) — the only place where the native provider fields still
 * exist before conversion to Anthropic shape.
 *
 * Order of fallbacks is deliberate: the first non-zero match wins, so
 * adding a provider that combines shapes is safe as long as we list the
 * most authoritative field first.
 */
export function extractCacheReadFromRawUsage(usage: RawUsage): number {
  if (!usage || typeof usage !== 'object') return 0
  const u = usage as Record<string, unknown>
  // 1. Anthropic-native shape — already normalized upstream.
  const anthropicRead = asNumber(u.cache_read_input_tokens)
  if (anthropicRead > 0) return anthropicRead
  // 2. OpenAI / Codex — cached_tokens nested under input/prompt details.
  //    Responses API uses `input_tokens_details`, Chat Completions uses
  //    `prompt_tokens_details`; some models report both with the same value.
  const openaiNested =
    asNumber(pickPath(usage, ['input_tokens_details', 'cached_tokens'])) ||
    asNumber(pickPath(usage, ['prompt_tokens_details', 'cached_tokens']))
  if (openaiNested > 0) return openaiNested
  // 3. Kimi / Moonshot — top-level cached_tokens (not nested).
  const kimi = asNumber(u.cached_tokens)
  if (kimi > 0) return kimi
  // 4. DeepSeek — hit/miss split at top level.
  const deepseek = asNumber(u.prompt_cache_hit_tokens)
  if (deepseek > 0) return deepseek
  // 5. Gemini — cached_content_token_count.
  const gemini = asNumber(u.cached_content_token_count)
  if (gemini > 0) return gemini
  return 0
}

/**
 * Shape produced by the shim layer — matches the Anthropic BetaUsage
 * fields that every downstream caller (cost-tracker, REPL, /cache-stats)
 * consumes. Keeping it in this module lets the shim and the integration
 * tests share one definition and eliminates the drift class of bugs
 * where a shim is updated but a test simulator isn't.
 */
export type NormalizedShimUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

/**
 * Convert raw provider usage (any known shape) into the Anthropic-shape
 * `NormalizedShimUsage` used throughout the codebase. Single source of
 * truth for the shim layer — `codexShim.makeUsage`,
 * `openaiShim.convertChunkUsage`, and the non-streaming response in
 * `OpenAIShimMessages` all call this helper, and the integration test
 * calls it directly instead of re-implementing the conversion.
 *
 * Design contract:
 *   - `cache_read_input_tokens` comes from `extractCacheReadFromRawUsage`
 *     (provider-aware extraction).
 *   - `input_tokens` is rewritten to Anthropic convention: FRESH only,
 *     with `cache_read` subtracted from the raw prompt count if the
 *     provider included it there (OpenAI family does; Anthropic native
 *     already excludes it).
 *   - `cache_creation_input_tokens` is always 0 at the shim boundary —
 *     only Anthropic native emits a non-zero creation count, and it
 *     doesn't flow through these shims.
 *   - Output token count accepts both `output_tokens` (Codex/Responses)
 *     and `completion_tokens` (Chat Completions).
 */
export function buildAnthropicUsageFromRawUsage(
  raw: RawUsage,
): NormalizedShimUsage {
  const cacheRead = extractCacheReadFromRawUsage(raw)
  const u = (raw ?? {}) as Record<string, unknown>
  const rawInput =
    asNumber(u.input_tokens) || asNumber(u.prompt_tokens)
  const fresh = rawInput >= cacheRead ? rawInput - cacheRead : rawInput
  const output =
    asNumber(u.output_tokens) || asNumber(u.completion_tokens)
  return {
    input_tokens: fresh,
    output_tokens: output,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cacheRead,
  }
}

/**
 * Extract a unified CacheMetrics from POST-SHIM (Anthropic-shape) usage.
 *
 * By the time this runs, openaiShim/codexShim have already converted
 * raw provider fields into `cache_read_input_tokens` (via
 * `extractCacheReadFromRawUsage`) and adjusted `input_tokens` to be
 * "fresh only" per Anthropic convention. This function is therefore
 * deliberately provider-independent for the numeric extraction — the
 * `provider` argument is used only to surface `supported: false` for
 * providers that expose no cache data at all.
 */
export function extractCacheMetrics(
  usage: RawUsage,
  provider: CacheAwareProvider,
): CacheMetrics {
  if (!usage || typeof usage !== 'object') return UNSUPPORTED
  // Copilot vanilla (no Claude) and Ollama don't expose cache fields at
  // all. Returning supported:false lets the REPL print "N/A" instead of
  // lying with 0%. Every other provider has been normalized to the
  // Anthropic shape by the shim, so we read uniformly below.
  if (
    provider === 'copilot' ||
    provider === 'ollama' ||
    provider === 'self-hosted'
  ) {
    return UNSUPPORTED
  }

  const u = usage as Record<string, unknown>
  const read = asNumber(u.cache_read_input_tokens)
  const created = asNumber(u.cache_creation_input_tokens)
  const fresh = asNumber(u.input_tokens)
  // total = fresh + read + created — shim already stripped `read` out of
  // `fresh` so the three components don't double-count. This matches the
  // Anthropic convention even when the upstream was OpenAI/Kimi/DeepSeek.
  const total = read + created + fresh
  return {
    read,
    created,
    total,
    hitRate: total > 0 ? read / total : null,
    supported: true,
  }
}

/**
 * Format a CacheMetrics value into a human-facing one-liner used by
 * `showCacheStats: 'compact'`. Stable format — snapshot-tested.
 *
 * Examples:
 *   "[Cache: 1.2k read • hit 12%]"
 *   "[Cache: N/A]"                  (unsupported provider)
 *   "[Cache: cold]"                 (supported, no reads yet)
 */
export function formatCacheMetricsCompact(metrics: CacheMetrics): string {
  if (!metrics.supported) return '[Cache: N/A]'
  if (metrics.read === 0 && metrics.created === 0) return '[Cache: cold]'
  const parts: string[] = [`${formatCompactNumber(metrics.read)} read`]
  if (metrics.hitRate !== null) {
    parts.push(`hit ${Math.round(metrics.hitRate * 100)}%`)
  }
  return `[Cache: ${parts.join(' • ')}]`
}

/**
 * Format a CacheMetrics value into a multi-field breakdown used by
 * `showCacheStats: 'full'`. Stable format — snapshot-tested.
 *
 * Example:
 *   "[Cache: read=1.2k created=340 hit=12%]"
 */
export function formatCacheMetricsFull(metrics: CacheMetrics): string {
  if (!metrics.supported) return '[Cache: N/A]'
  const parts: string[] = [
    `read=${formatCompactNumber(metrics.read)}`,
    `created=${formatCompactNumber(metrics.created)}`,
  ]
  if (metrics.hitRate !== null) {
    parts.push(`hit=${Math.round(metrics.hitRate * 100)}%`)
  } else {
    parts.push('hit=n/a')
  }
  return `[Cache: ${parts.join(' ')}]`
}

// Compact 1.2k-style formatter. Duplicated here (not imported from
// utils/format.ts) because this module should stay dependency-light and
// deterministic — utils/format pulls Intl locale state which varies.
function formatCompactNumber(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

/** Sum two CacheMetrics, preserving `supported` as true only if both are. */
export function addCacheMetrics(a: CacheMetrics, b: CacheMetrics): CacheMetrics {
  // Copy elision: if either side is the unsupported sentinel, return the
  // other as-is so aggregates on a purely-unsupported session stay cheap.
  if (!a.supported && !b.supported) return UNSUPPORTED
  if (!a.supported) return b
  if (!b.supported) return a
  const read = a.read + b.read
  const created = a.created + b.created
  const total = a.total + b.total
  return {
    read,
    created,
    total,
    hitRate: total > 0 ? read / total : null,
    supported: true,
  }
}

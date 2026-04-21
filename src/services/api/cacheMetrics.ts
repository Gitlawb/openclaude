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
   * Total input tokens charged for this request (cached + fresh, by
   * provider convention — see per-provider branches for specifics).
   * Used as denominator for hit-rate when available.
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
 * Map the canonical APIProvider enum (+ environment hints) into a
 * cache-capability bucket. We separate `copilot` (no cache) from
 * `copilot-claude` (Anthropic shim via Copilot with explicit cache)
 * because the two behave very differently even under the same provider
 * flag — see `isGithubNativeAnthropicMode` in utils/model/providers.ts.
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
    const url = (hints?.openAiBaseUrl ?? '').toLowerCase()
    // Local Ollama / LM Studio servers never return cache fields. Heuristic
    // check keeps the normalizer honest without requiring a separate env var.
    if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('11434') || url.includes('1234')) {
      return 'ollama'
    }
    if (url.includes('moonshot') || url.includes('kimi')) return 'kimi'
    if (url.includes('deepseek')) return 'deepseek'
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
  if (provider === 'copilot' || provider === 'ollama') return UNSUPPORTED

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

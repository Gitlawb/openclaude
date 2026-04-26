/**
 * Integration tests for the raw-usage → shim → cost-tracker pipeline.
 *
 * These tests simulate what happens on each provider end-to-end:
 *   1. The provider returns a raw `usage` object in its native shape.
 *   2. The shim (openaiShim.convertChunkUsage / codexShim.makeUsage)
 *      rewrites it to Anthropic shape via buildAnthropicUsageFromRawUsage.
 *   3. cost-tracker feeds the shimmed usage to extractCacheMetrics.
 *
 * The unit tests in cacheMetrics.test.ts exercise each layer in isolation.
 * This file exists so that a regression in ANY one of them (e.g. someone
 * adding a new provider branch to the helper but forgetting to wire it
 * into the shim) surfaces as an integration failure rather than silently
 * showing "[Cache: cold]" in production.
 *
 * We call `buildAnthropicUsageFromRawUsage` directly instead of
 * re-implementing the shim behavior locally. Both shims
 * (`codexShim.makeUsage`, `openaiShim.convertChunkUsage`, and the
 * non-streaming path in `OpenAIShimMessages`) delegate to this helper,
 * so this test covers the exact same code that runs in production —
 * no simulator drift possible.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildAnthropicUsageFromRawUsage,
  extractCacheMetrics,
  formatCacheMetricsCompact,
  formatCacheMetricsFull,
  resolveCacheProvider,
  type CacheAwareProvider,
} from './cacheMetrics.js'

type Scenario = {
  name: string
  provider: CacheAwareProvider
  rawUsage: Record<string, unknown>
  expectedRead: number
  expectedTotal: number
  expectedHitRate: number
  expectedFreshInput: number
}

// End-to-end scenarios for every provider shape the OpenClaude shim layer
// might see. `expectedTotal` is what a user should see as "input this
// request", `expectedHitRate` is what `/cache-stats` should display.
const scenarios: Scenario[] = [
  {
    name: 'Anthropic native (firstParty) — passthrough',
    provider: 'anthropic',
    rawUsage: {
      input_tokens: 200,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 100,
    },
    expectedRead: 800,
    // Anthropic native doesn't go through the shim in production, but
    // buildAnthropicUsageFromRawUsage handles it correctly as passthrough:
    // prompt_tokens fallback is 0, so fresh comes from input_tokens (200),
    // cache_read is picked up from cache_read_input_tokens (800).
    expectedTotal: 1_000, // 200 fresh + 800 read (created is not tracked at this layer)
    expectedHitRate: 800 / 1_000,
    expectedFreshInput: 200,
  },
  {
    name: 'OpenAI Chat Completions via openaiShim',
    provider: 'openai',
    rawUsage: {
      prompt_tokens: 2_000,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 1_200 },
    },
    expectedRead: 1_200,
    expectedTotal: 2_000, // 800 fresh + 1200 read
    expectedHitRate: 0.6,
    expectedFreshInput: 800,
  },
  {
    name: 'Codex Responses API via codexShim',
    provider: 'codex',
    rawUsage: {
      input_tokens: 1_500,
      output_tokens: 50,
      input_tokens_details: { cached_tokens: 600 },
    },
    expectedRead: 600,
    expectedTotal: 1_500,
    expectedHitRate: 0.4,
    expectedFreshInput: 900,
  },
  {
    name: 'Kimi / Moonshot via openaiShim — top-level cached_tokens',
    provider: 'kimi',
    rawUsage: {
      prompt_tokens: 1_000,
      completion_tokens: 120,
      cached_tokens: 400,
    },
    expectedRead: 400,
    expectedTotal: 1_000,
    expectedHitRate: 0.4,
    expectedFreshInput: 600,
  },
  {
    name: 'DeepSeek via openaiShim — prompt_cache_hit_tokens',
    provider: 'deepseek',
    rawUsage: {
      prompt_tokens: 1_000,
      completion_tokens: 40,
      prompt_cache_hit_tokens: 700,
      prompt_cache_miss_tokens: 300,
    },
    expectedRead: 700,
    expectedTotal: 1_000,
    expectedHitRate: 0.7,
    expectedFreshInput: 300,
  },
  {
    name: 'Gemini via openaiShim — cached_content_token_count',
    provider: 'gemini',
    rawUsage: {
      prompt_tokens: 4_000,
      completion_tokens: 200,
      cached_content_token_count: 3_200,
    },
    expectedRead: 3_200,
    expectedTotal: 4_000,
    expectedHitRate: 0.8,
    expectedFreshInput: 800,
  },
]

describe('raw usage → shim → extractCacheMetrics pipeline', () => {
  for (const s of scenarios) {
    test(s.name, () => {
      // Call the same helper the shims call in production — no
      // simulator, no possibility of drift.
      const shimmed = buildAnthropicUsageFromRawUsage(s.rawUsage)
      expect(shimmed.cache_read_input_tokens).toBe(s.expectedRead)
      expect(shimmed.input_tokens).toBe(s.expectedFreshInput)

      const metrics = extractCacheMetrics(
        shimmed as unknown as Record<string, unknown>,
        s.provider,
      )
      expect(metrics.supported).toBe(true)
      expect(metrics.read).toBe(s.expectedRead)
      expect(metrics.total).toBe(s.expectedTotal)
      expect(metrics.hitRate).toBeCloseTo(s.expectedHitRate, 4)
    })
  }
})

describe('no-cache providers — pipeline honestly reports unsupported', () => {
  test('GitHub Copilot (vanilla) — shim runs, but provider bucket maps to unsupported', () => {
    const shimmed = buildAnthropicUsageFromRawUsage({
      prompt_tokens: 500,
      completion_tokens: 40,
    })
    // Shim normalized correctly (0 cache_read), but Copilot-vanilla must
    // surface as unsupported so /cache-stats shows "N/A" instead of "0%".
    expect(shimmed.cache_read_input_tokens).toBe(0)
    const metrics = extractCacheMetrics(
      shimmed as unknown as Record<string, unknown>,
      'copilot',
    )
    expect(metrics.supported).toBe(false)
    expect(metrics.hitRate).toBeNull()
  })

  test('Ollama (local) — same treatment as Copilot-vanilla', () => {
    const shimmed = buildAnthropicUsageFromRawUsage({
      prompt_tokens: 1_000,
      completion_tokens: 200,
    })
    const metrics = extractCacheMetrics(
      shimmed as unknown as Record<string, unknown>,
      'ollama',
    )
    expect(metrics.supported).toBe(false)
  })
})

describe('display path end-to-end — private-IP, custom-port, self-hosted endpoints', () => {
  // These tests exercise the FULL pipeline that runs when a user
  // configures OpenClaude against a self-hosted OpenAI-compatible
  // server (vLLM, LM Studio, LocalAI, text-generation-webui, etc.):
  //
  //   OPENAI_BASE_URL → resolveCacheProvider → real provider usage →
  //   buildAnthropicUsageFromRawUsage → extractCacheMetrics →
  //   formatCacheMetricsCompact / Full (= what user sees in REPL and
  //   via /cache-stats)
  //
  // Pre-fix behavior: substring check missed these URLs, they fell
  // into the 'openai' bucket, and the display showed '[Cache: cold]' —
  // i.e. implied a cache miss when the provider simply doesn't report
  // cache fields. Post-fix: '[Cache: N/A]' every time.

  const privateEndpoints: Array<{ name: string; baseUrl: string }> = [
    { name: 'vLLM on RFC1918 LAN IP', baseUrl: 'http://192.168.1.50:8000/v1' },
    { name: 'LocalAI on 10.x.x.x corporate network', baseUrl: 'http://10.0.0.7:8080/v1' },
    { name: 'self-hosted on 172.16.x.x', baseUrl: 'http://172.20.0.3:5000/v1' },
    { name: 'reverse-proxied on .internal DNS', baseUrl: 'http://llm.internal:5000/v1' },
    { name: 'mDNS .local hostname', baseUrl: 'http://box.local:8080/v1' },
    { name: 'RFC 8375 .home.arpa', baseUrl: 'http://vllm.home.arpa/v1' },
    { name: 'CGNAT / Tailscale 100.64.x.x', baseUrl: 'http://100.64.1.5:8000/v1' },
    { name: 'IPv6 loopback literal', baseUrl: 'http://[::1]:5000/v1' },
    { name: 'IPv6 link-local', baseUrl: 'http://[fe80::1]:8000/v1' },
    { name: 'IPv6 ULA fc00::/7', baseUrl: 'http://[fd12:3456::7]:8080/v1' },
    { name: 'link-local cloud-metadata IP', baseUrl: 'http://169.254.169.254/v1' },
  ]

  for (const { name, baseUrl } of privateEndpoints) {
    test(`${name} (${baseUrl}) — renders [Cache: N/A], not [Cache: cold]`, () => {
      // 1. URL resolves to self-hosted bucket.
      const bucket = resolveCacheProvider('openai', { openAiBaseUrl: baseUrl })
      expect(bucket).toBe('self-hosted')

      // 2. Typical self-hosted server returns OpenAI-shape usage with no
      //    cache fields — the shim normalizes it cleanly.
      const shimmed = buildAnthropicUsageFromRawUsage({
        prompt_tokens: 1_200,
        completion_tokens: 250,
      })
      expect(shimmed.cache_read_input_tokens).toBe(0)

      // 3. The display path marks the bucket unsupported.
      const metrics = extractCacheMetrics(
        shimmed as unknown as Record<string, unknown>,
        bucket,
      )
      expect(metrics.supported).toBe(false)
      expect(metrics.hitRate).toBeNull()

      // 4. User-visible output — both formats honor the unsupported flag.
      expect(formatCacheMetricsCompact(metrics)).toBe('[Cache: N/A]')
      expect(formatCacheMetricsFull(metrics)).toBe('[Cache: N/A]')
    })
  }

  test('public-looking URL with non-standard port stays in openai bucket (no false positive)', () => {
    // A real hosted API that happens to run on a custom port must NOT
    // be misclassified as self-hosted. This guards the fix against
    // over-matching.
    const bucket = resolveCacheProvider('openai', {
      openAiBaseUrl: 'https://api.openai.com:8443/v1',
    })
    expect(bucket).toBe('openai')
  })

  test('private IP + hosted-provider keyword in path → self-hosted wins', () => {
    // A URL like 'http://10.0.0.5:8000/v1/deepseek-proxy' has "deepseek"
    // in the path but the upstream is a LAN box, not the real DeepSeek.
    // Priority ordering in resolveCacheProvider must put self-hosted
    // detection first.
    const bucket = resolveCacheProvider('openai', {
      openAiBaseUrl: 'http://10.0.0.5:8000/v1/deepseek-proxy',
    })
    expect(bucket).toBe('self-hosted')
  })

  test('self-hosted proxy forwarding real upstream cache data is NOT discarded', () => {
    // Review-blocker regression: an enterprise setup with an internal
    // reverse proxy on a private URL forwarding to OpenAI / Kimi /
    // DeepSeek / Gemini WILL deliver real cache fields via the shim.
    // Pre-fix, the URL heuristic → self-hosted → unconditional
    // `supported: false` discarded the data and rendered '[Cache: N/A]'
    // even though valid cache metrics were on the payload. Post-fix,
    // the data decides: non-zero cache activity trumps the URL bucket.
    const bucket = resolveCacheProvider('openai', {
      openAiBaseUrl: 'http://llm-proxy.corp.internal:5000/v1',
    })
    expect(bucket).toBe('self-hosted')

    // Typical raw Kimi shape (the reverse proxy forwards this through
    // unchanged). Shim normalizes to Anthropic shape.
    const raw = { prompt_tokens: 2_000, cached_tokens: 800 }
    const shimmed = buildAnthropicUsageFromRawUsage(raw)

    // Display path with the fix: data is preserved end-to-end.
    const metrics = extractCacheMetrics(
      shimmed as unknown as Record<string, unknown>,
      bucket,
    )
    expect(metrics.supported).toBe(true)
    expect(metrics.read).toBe(800)
    expect(metrics.hitRate).toBe(0.4)
    expect(formatCacheMetricsCompact(metrics)).toBe(
      '[Cache: 800 read • hit 40%]',
    )
  })
})

describe('regression guards — bug reproducers', () => {
  test('Kimi cache hit survives the shim (pre-fix: silently dropped to 0)', () => {
    // Before the Option-C refactor, the shim only read
    // prompt_tokens_details.cached_tokens, so Kimi's top-level
    // cached_tokens (400 below) was lost — the tracker saw read=0 and
    // users saw "[Cache: cold]" even after real cache hits. This test
    // fails loudly if the helper forgets the top-level branch.
    const raw = { prompt_tokens: 800, cached_tokens: 300 }
    const shimmed = buildAnthropicUsageFromRawUsage(raw)
    const metrics = extractCacheMetrics(
      shimmed as unknown as Record<string, unknown>,
      'kimi',
    )
    expect(metrics.read).toBe(300)
    expect(metrics.hitRate).toBeGreaterThan(0)
  })

  test('DeepSeek cache hit survives the shim (pre-fix: silently dropped to 0)', () => {
    const raw = {
      prompt_tokens: 1_200,
      prompt_cache_hit_tokens: 900,
      prompt_cache_miss_tokens: 300,
    }
    const shimmed = buildAnthropicUsageFromRawUsage(raw)
    const metrics = extractCacheMetrics(
      shimmed as unknown as Record<string, unknown>,
      'deepseek',
    )
    expect(metrics.read).toBe(900)
    expect(metrics.hitRate).toBe(0.75)
  })

  test('Codex makeUsage no longer double-bills (pre-fix: input_tokens kept cached)', () => {
    // Pre-fix, codexShim.makeUsage set input_tokens to the raw value
    // without subtracting cached_tokens, so modelCost.calculateUSDCost
    // charged the same tokens under both input_tokens * rate AND
    // cache_read_input_tokens * rate. This test enforces the Anthropic
    // convention at the shim boundary.
    const raw = {
      input_tokens: 2_000,
      input_tokens_details: { cached_tokens: 1_500 },
    }
    const shimmed = buildAnthropicUsageFromRawUsage(raw)
    expect(shimmed.input_tokens).toBe(500) // 2000 - 1500, not 2000
    expect(shimmed.cache_read_input_tokens).toBe(1_500)
  })
})

import { expect, test, describe } from 'bun:test'
import {
  extractCacheMetrics,
  extractCacheReadFromRawUsage,
  resolveCacheProvider,
  formatCacheMetricsCompact,
  formatCacheMetricsFull,
  addCacheMetrics,
} from './cacheMetrics.js'

describe('extractCacheMetrics — Anthropic (firstParty/bedrock/vertex/foundry)', () => {
  test('reports read/created separately and computes hit rate over total input', () => {
    const usage = {
      input_tokens: 300,
      output_tokens: 100,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 200,
    }
    const m = extractCacheMetrics(usage, 'anthropic')
    expect(m.supported).toBe(true)
    expect(m.read).toBe(800)
    expect(m.created).toBe(200)
    // total = fresh(300) + created(200) + read(800) = 1300
    expect(m.total).toBe(1300)
    expect(m.hitRate).toBeCloseTo(800 / 1300, 4)
  })

  test('returns cold metrics when no cache activity yet', () => {
    const m = extractCacheMetrics({ input_tokens: 500 }, 'anthropic')
    expect(m.supported).toBe(true)
    expect(m.read).toBe(0)
    expect(m.created).toBe(0)
    expect(m.hitRate).toBe(0)
  })

  test('null hit rate when usage has no input at all', () => {
    const m = extractCacheMetrics({}, 'anthropic')
    expect(m.supported).toBe(true)
    expect(m.hitRate).toBeNull()
  })
})

// NOTE: OpenAI/Codex/Kimi/DeepSeek/Gemini raw shapes are now tested through
// extractCacheReadFromRawUsage (below). extractCacheMetrics sees the
// post-shim Anthropic shape for every provider, so the tests here verify
// that the shape lookup works uniformly against the shimmed fields.

describe('extractCacheMetrics — post-shim Anthropic shape (applies to all providers)', () => {
  test('OpenAI post-shim (openai bucket) — reads Anthropic fields injected by convertChunkUsage', () => {
    // This is what cost-tracker actually sees for OpenAI upstreams: the
    // shim has already subtracted cached from prompt_tokens and moved it
    // to cache_read_input_tokens.
    const shimmed = {
      input_tokens: 800, // fresh = 2000 - 1200
      output_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1_200,
    }
    const m = extractCacheMetrics(shimmed, 'openai')
    expect(m.supported).toBe(true)
    expect(m.read).toBe(1_200)
    expect(m.created).toBe(0)
    expect(m.total).toBe(2_000) // 800 fresh + 1200 read
    expect(m.hitRate).toBe(0.6)
  })

  test('Codex post-shim — same Anthropic shape as OpenAI', () => {
    const shimmed = {
      input_tokens: 900, // 1500 - 600
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 600,
    }
    const m = extractCacheMetrics(shimmed, 'codex')
    expect(m.read).toBe(600)
    expect(m.total).toBe(1_500)
    expect(m.hitRate).toBe(0.4)
  })

  test('Kimi post-shim — shim moved top-level cached_tokens into Anthropic field', () => {
    const shimmed = {
      input_tokens: 600, // 1000 - 400
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 400,
    }
    const m = extractCacheMetrics(shimmed, 'kimi')
    expect(m.read).toBe(400)
    expect(m.total).toBe(1_000)
    expect(m.hitRate).toBe(0.4)
  })

  test('DeepSeek post-shim — hit moved to cache_read_input_tokens, miss to input_tokens', () => {
    const shimmed = {
      input_tokens: 300, // miss
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 700, // hit
    }
    const m = extractCacheMetrics(shimmed, 'deepseek')
    expect(m.read).toBe(700)
    expect(m.total).toBe(1_000)
    expect(m.hitRate).toBe(0.7)
  })

  test('Gemini post-shim — cached_content_token_count moved to cache_read_input_tokens', () => {
    const shimmed = {
      input_tokens: 800, // 4000 - 3200
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3_200,
    }
    const m = extractCacheMetrics(shimmed, 'gemini')
    expect(m.read).toBe(3_200)
    expect(m.total).toBe(4_000)
    expect(m.hitRate).toBe(0.8)
  })
})

describe('extractCacheReadFromRawUsage — single source of truth for shim layer', () => {
  test('Anthropic-native passthrough: cache_read_input_tokens', () => {
    expect(
      extractCacheReadFromRawUsage({ cache_read_input_tokens: 1_500 }),
    ).toBe(1_500)
  })

  test('OpenAI Chat Completions: prompt_tokens_details.cached_tokens', () => {
    expect(
      extractCacheReadFromRawUsage({
        prompt_tokens: 2_000,
        prompt_tokens_details: { cached_tokens: 1_200 },
      }),
    ).toBe(1_200)
  })

  test('Codex Responses API: input_tokens_details.cached_tokens', () => {
    expect(
      extractCacheReadFromRawUsage({
        input_tokens: 1_500,
        input_tokens_details: { cached_tokens: 600 },
      }),
    ).toBe(600)
  })

  test('Kimi / Moonshot: top-level cached_tokens', () => {
    expect(
      extractCacheReadFromRawUsage({ prompt_tokens: 1_000, cached_tokens: 400 }),
    ).toBe(400)
  })

  test('DeepSeek: prompt_cache_hit_tokens', () => {
    expect(
      extractCacheReadFromRawUsage({
        prompt_cache_hit_tokens: 700,
        prompt_cache_miss_tokens: 300,
      }),
    ).toBe(700)
  })

  test('Gemini: cached_content_token_count', () => {
    expect(
      extractCacheReadFromRawUsage({
        prompt_token_count: 4_000,
        cached_content_token_count: 3_200,
      }),
    ).toBe(3_200)
  })

  test('no cache fields at all → 0 (Copilot/Ollama/unknown shape)', () => {
    expect(extractCacheReadFromRawUsage({ prompt_tokens: 500 })).toBe(0)
  })

  test('Anthropic field wins over OpenAI field when both present', () => {
    // Shouldn't happen in practice, but if usage was double-annotated we
    // trust the Anthropic-native number (it's the more authoritative one).
    expect(
      extractCacheReadFromRawUsage({
        cache_read_input_tokens: 999,
        prompt_tokens_details: { cached_tokens: 111 },
      }),
    ).toBe(999)
  })

  test('null/undefined/non-object → 0', () => {
    expect(extractCacheReadFromRawUsage(null)).toBe(0)
    expect(extractCacheReadFromRawUsage(undefined)).toBe(0)
    expect(extractCacheReadFromRawUsage('nope' as unknown as never)).toBe(0)
  })
})

describe('extractCacheMetrics — Copilot / Ollama (unsupported)', () => {
  test('returns supported:false with all zeros and null hitRate for Copilot', () => {
    const m = extractCacheMetrics({ prompt_tokens: 1000 }, 'copilot')
    expect(m.supported).toBe(false)
    expect(m.read).toBe(0)
    expect(m.created).toBe(0)
    expect(m.hitRate).toBeNull()
  })

  test('returns supported:false for Ollama', () => {
    const m = extractCacheMetrics({ prompt_tokens: 42 }, 'ollama')
    expect(m.supported).toBe(false)
    expect(m.hitRate).toBeNull()
  })

  test('Copilot serving Claude (copilot-claude) is supported and uses Anthropic fields', () => {
    const usage = {
      input_tokens: 200,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 100,
    }
    const m = extractCacheMetrics(usage, 'copilot-claude')
    expect(m.supported).toBe(true)
    expect(m.read).toBe(800)
    expect(m.created).toBe(100)
    expect(m.total).toBe(1_100)
  })
})

describe('extractCacheMetrics — bad/empty input', () => {
  test('null usage returns unsupported', () => {
    expect(extractCacheMetrics(null, 'anthropic').supported).toBe(false)
  })

  test('non-object usage returns unsupported', () => {
    expect(extractCacheMetrics('oops' as unknown as never, 'openai').supported).toBe(
      false,
    )
  })
})

describe('resolveCacheProvider', () => {
  test('firstParty → anthropic', () => {
    expect(resolveCacheProvider('firstParty')).toBe('anthropic')
  })
  test('bedrock/vertex/foundry → anthropic', () => {
    expect(resolveCacheProvider('bedrock')).toBe('anthropic')
    expect(resolveCacheProvider('vertex')).toBe('anthropic')
    expect(resolveCacheProvider('foundry')).toBe('anthropic')
  })
  test('github without claude hint → copilot (unsupported)', () => {
    expect(resolveCacheProvider('github')).toBe('copilot')
  })
  test('github with claude hint → copilot-claude', () => {
    expect(
      resolveCacheProvider('github', { githubNativeAnthropic: true }),
    ).toBe('copilot-claude')
  })
  test('openai with local base URL → ollama', () => {
    expect(
      resolveCacheProvider('openai', { openAiBaseUrl: 'http://localhost:11434/v1' }),
    ).toBe('ollama')
    expect(
      resolveCacheProvider('openai', { openAiBaseUrl: 'http://127.0.0.1:1234/v1' }),
    ).toBe('ollama')
  })
  test('openai with moonshot URL → kimi', () => {
    expect(
      resolveCacheProvider('openai', { openAiBaseUrl: 'https://api.moonshot.ai/v1' }),
    ).toBe('kimi')
  })
  test('openai with deepseek URL → deepseek', () => {
    expect(
      resolveCacheProvider('openai', { openAiBaseUrl: 'https://api.deepseek.com/v1' }),
    ).toBe('deepseek')
  })
  test('plain openai remains openai', () => {
    expect(
      resolveCacheProvider('openai', { openAiBaseUrl: 'https://api.openai.com/v1' }),
    ).toBe('openai')
  })
  test('codex → codex', () => {
    expect(resolveCacheProvider('codex')).toBe('codex')
  })
  test('gemini → gemini', () => {
    expect(resolveCacheProvider('gemini')).toBe('gemini')
  })
})

describe('formatCacheMetricsCompact — snapshot-stable output', () => {
  test('supported with reads shows "k" abbreviation and hit rate', () => {
    const out = formatCacheMetricsCompact({
      read: 1_234,
      created: 0,
      total: 10_000,
      hitRate: 0.1234,
      supported: true,
    })
    expect(out).toBe('[Cache: 1.2k read • hit 12%]')
  })

  test('supported with no cache activity renders "cold"', () => {
    const out = formatCacheMetricsCompact({
      read: 0,
      created: 0,
      total: 500,
      hitRate: 0,
      supported: true,
    })
    expect(out).toBe('[Cache: cold]')
  })

  test('unsupported renders "N/A"', () => {
    const out = formatCacheMetricsCompact({
      read: 0,
      created: 0,
      total: 0,
      hitRate: null,
      supported: false,
    })
    expect(out).toBe('[Cache: N/A]')
  })

  test('small numbers render without abbreviation', () => {
    const out = formatCacheMetricsCompact({
      read: 42,
      created: 0,
      total: 100,
      hitRate: 0.42,
      supported: true,
    })
    expect(out).toBe('[Cache: 42 read • hit 42%]')
  })
})

describe('formatCacheMetricsFull — snapshot-stable output', () => {
  test('supported shows all fields', () => {
    const out = formatCacheMetricsFull({
      read: 1_234,
      created: 250,
      total: 10_000,
      hitRate: 0.1234,
      supported: true,
    })
    expect(out).toBe('[Cache: read=1.2k created=250 hit=12%]')
  })

  test('null hit rate renders n/a', () => {
    const out = formatCacheMetricsFull({
      read: 0,
      created: 0,
      total: 0,
      hitRate: null,
      supported: true,
    })
    expect(out).toBe('[Cache: read=0 created=0 hit=n/a]')
  })

  test('unsupported renders "N/A"', () => {
    const out = formatCacheMetricsFull({
      read: 0,
      created: 0,
      total: 0,
      hitRate: null,
      supported: false,
    })
    expect(out).toBe('[Cache: N/A]')
  })
})

describe('hit-rate edge cases (plan-mandated coverage)', () => {
  test('0 read / 0 created on supported provider → hitRate = 0 (not null) when total > 0', () => {
    const m = extractCacheMetrics({ input_tokens: 500 }, 'anthropic')
    expect(m.read).toBe(0)
    expect(m.created).toBe(0)
    expect(m.hitRate).toBe(0)
  })

  test('read only (no created) computes proportion correctly', () => {
    const m = extractCacheMetrics(
      { input_tokens: 0, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
      'anthropic',
    )
    expect(m.read).toBe(800)
    expect(m.created).toBe(0)
    expect(m.total).toBe(800)
    expect(m.hitRate).toBe(1)
  })

  test('created only (first turn — no reads yet) gives 0 hit rate', () => {
    const m = extractCacheMetrics(
      {
        input_tokens: 200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1_000,
      },
      'anthropic',
    )
    expect(m.read).toBe(0)
    expect(m.created).toBe(1_000)
    expect(m.total).toBe(1_200)
    expect(m.hitRate).toBe(0)
  })

  test('mixed read + created + fresh input — full denominator', () => {
    const m = extractCacheMetrics(
      {
        input_tokens: 500,
        cache_read_input_tokens: 3_000,
        cache_creation_input_tokens: 1_500,
      },
      'anthropic',
    )
    // Denominator = fresh(500) + created(1500) + read(3000) = 5_000
    // Hit = read/total = 3000 / 5000 = 0.6
    expect(m.total).toBe(5_000)
    expect(m.hitRate).toBe(0.6)
  })

  test('N/A (unsupported provider) preserves null hit-rate even with populated usage', () => {
    // Simulate a Copilot usage payload that might look like OpenAI shape —
    // we must NOT try to read it and must report supported:false.
    const m = extractCacheMetrics(
      { prompt_tokens: 5_000, prompt_tokens_details: { cached_tokens: 2_000 } },
      'copilot',
    )
    expect(m.supported).toBe(false)
    expect(m.read).toBe(0)
    expect(m.hitRate).toBeNull()
  })
})

describe('addCacheMetrics — session aggregation', () => {
  test('sums read/created/total and recomputes hit rate', () => {
    const a = {
      read: 100,
      created: 50,
      total: 300,
      hitRate: 100 / 300,
      supported: true,
    }
    const b = {
      read: 200,
      created: 0,
      total: 400,
      hitRate: 0.5,
      supported: true,
    }
    const sum = addCacheMetrics(a, b)
    expect(sum.read).toBe(300)
    expect(sum.created).toBe(50)
    expect(sum.total).toBe(700)
    expect(sum.hitRate).toBeCloseTo(300 / 700, 5)
  })

  test('unsupported + supported = supported (so we never lose honest data)', () => {
    const unsupported = {
      read: 0,
      created: 0,
      total: 0,
      hitRate: null,
      supported: false,
    }
    const supported = {
      read: 10,
      created: 0,
      total: 100,
      hitRate: 0.1,
      supported: true,
    }
    expect(addCacheMetrics(unsupported, supported)).toBe(supported)
    expect(addCacheMetrics(supported, unsupported)).toBe(supported)
  })

  test('unsupported + unsupported = unsupported', () => {
    const u = {
      read: 0,
      created: 0,
      total: 0,
      hitRate: null,
      supported: false,
    }
    const sum = addCacheMetrics(u, u)
    expect(sum.supported).toBe(false)
  })
})

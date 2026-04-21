import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  __resetContextCacheForTests,
  __setConfigDirForTests,
  discoverContextWindow,
  getCachedContextWindow,
  rememberContextWindow,
  warmContextWindowCache,
} from './modelContextDiscovery.ts'

const originalFetch = globalThis.fetch

let tempHome: string

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'openclaude-mctest-'))
  // Inject path directly — env-var isolation is racy under bun's parallel file
  // execution because process.env is process-global.
  __setConfigDirForTests(tempHome)
})

afterEach(() => {
  __setConfigDirForTests(null)
  rmSync(tempHome, { recursive: true, force: true })
  globalThis.fetch = originalFetch
  __resetContextCacheForTests()
})

const CACHE_PATH = (home: string): string => join(home, 'model-metadata.json')

describe('cache read/write', () => {
  test('returns undefined when no cache file exists', () => {
    expect(getCachedContextWindow('https://openrouter.ai/api/v1', 'model-x'))
      .toBeUndefined()
  })

  test('rememberContextWindow persists to disk and is readable in-memory', () => {
    rememberContextWindow(
      'https://openrouter.ai/api/v1',
      'anthropic/claude-3.5-sonnet',
      200_000,
      'test',
    )

    expect(
      getCachedContextWindow(
        'https://openrouter.ai/api/v1',
        'anthropic/claude-3.5-sonnet',
      ),
    ).toBe(200_000)

    expect(existsSync(CACHE_PATH(tempHome))).toBe(true)
    const raw = readFileSync(CACHE_PATH(tempHome), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
    expect(
      parsed.entries['https://openrouter.ai/api/v1::anthropic/claude-3.5-sonnet']
        ?.contextWindow,
    ).toBe(200_000)
  })

  test('trailing slashes in baseUrl are normalized', () => {
    rememberContextWindow(
      'https://openrouter.ai/api/v1/',
      'm',
      100,
      'test',
    )
    expect(getCachedContextWindow('https://openrouter.ai/api/v1', 'm')).toBe(100)
  })

  test('entries older than 30 days are ignored on load', () => {
    const stale = {
      version: 1,
      entries: {
        'https://example/v1::old-model': {
          contextWindow: 9999,
          discoveredAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
          source: 'stale',
        },
        'https://example/v1::fresh-model': {
          contextWindow: 128_000,
          discoveredAt: Date.now() - 1000,
          source: 'fresh',
        },
      },
    }
    writeFileSync(CACHE_PATH(tempHome), JSON.stringify(stale), 'utf8')
    __resetContextCacheForTests()

    expect(getCachedContextWindow('https://example/v1', 'old-model')).toBeUndefined()
    expect(getCachedContextWindow('https://example/v1', 'fresh-model')).toBe(128_000)
  })

  test('version mismatch discards cache entries', () => {
    const v99 = {
      version: 99,
      entries: {
        'https://example/v1::m': {
          contextWindow: 42,
          discoveredAt: Date.now(),
          source: 'v99',
        },
      },
    }
    writeFileSync(CACHE_PATH(tempHome), JSON.stringify(v99), 'utf8')
    __resetContextCacheForTests()

    expect(getCachedContextWindow('https://example/v1', 'm')).toBeUndefined()
  })

  test('malformed cache file is handled gracefully', () => {
    writeFileSync(CACHE_PATH(tempHome), 'not json{{{', 'utf8')
    __resetContextCacheForTests()
    expect(getCachedContextWindow('https://example/v1', 'm')).toBeUndefined()
  })
})

describe('discoverContextWindow — /v1/models/{id}', () => {
  test('parses OpenRouter-style context_length', async () => {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as URL).toString()
      expect(url).toBe(
        'https://openrouter.ai/api/v1/models/anthropic%2Fclaude-3.5-sonnet',
      )
      return new Response(
        JSON.stringify({
          id: 'anthropic/claude-3.5-sonnet',
          context_length: 200_000,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await discoverContextWindow(
      'https://openrouter.ai/api/v1',
      'anthropic/claude-3.5-sonnet',
    )
    expect(result?.contextWindow).toBe(200_000)
  })

  test('parses Together-style context_window', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ id: 'm', context_window: 131_072 }),
        { headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    const result = await discoverContextWindow(
      'https://api.together.xyz/v1',
      'm',
    )
    expect(result?.contextWindow).toBe(131_072)
  })

  test('parses vLLM max_model_len', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ id: 'm', max_model_len: 32_768 }),
        { headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    const result = await discoverContextWindow('http://localhost:8000/v1', 'm')
    expect(result?.contextWindow).toBe(32_768)
  })

  test('parses nested data field', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: { id: 'm', context_length: 64_000 } }),
        { headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    const result = await discoverContextWindow('https://example/v1', 'm')
    expect(result?.contextWindow).toBe(64_000)
  })

  test('does NOT treat max_tokens as the context window (it is output cap)', async () => {
    // Regression: max_tokens in the OpenAI schema is the output-completion
    // cap, not the context window. Caching 4096 here for a 128k-context
    // model would trigger aggressive premature auto-compaction. The
    // discoverer must ignore max_tokens entirely.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ id: 'm', max_tokens: 4096 }),
        { headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    const result = await discoverContextWindow('https://example/v1', 'm')
    expect(result).toBeUndefined()
  })

  test('prefers context_length when both max_tokens and context_length present', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ id: 'm', max_tokens: 4096, context_length: 128_000 }),
        { headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    const result = await discoverContextWindow('https://example/v1', 'm')
    expect(result?.contextWindow).toBe(128_000)
  })
})

describe('discoverContextWindow — fallback strategies', () => {
  test('falls back to /models list when /models/{id} is 404', async () => {
    let calls = 0
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      calls++
      const url = typeof input === 'string' ? input : (input as URL).toString()
      if (url.includes('/models/m')) {
        return new Response('not found', { status: 404 })
      }
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'other', context_length: 8_000 },
              { id: 'm', context_length: 48_000 },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await discoverContextWindow('https://example/v1', 'm')
    expect(result?.contextWindow).toBe(48_000)
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  test('falls back to Ollama /api/show when /v1 endpoints fail', async () => {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as URL).toString()
      if (url.includes('/api/show')) {
        return new Response(
          JSON.stringify({
            model_info: {
              'llama.context_length': 8_192,
              'general.architecture': 'llama',
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await discoverContextWindow(
      'http://localhost:11434/v1',
      'llama3',
    )
    expect(result?.contextWindow).toBe(8_192)
  })

  test('returns undefined when all strategies fail', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch
    const result = await discoverContextWindow('https://example/v1', 'm')
    expect(result).toBeUndefined()
  })

  test('network errors do not throw', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch
    const result = await discoverContextWindow('https://example/v1', 'm')
    expect(result).toBeUndefined()
  })
})

describe('warmContextWindowCache', () => {
  test('skips probe when a fresh entry already exists', async () => {
    rememberContextWindow('https://example/v1', 'm', 100, 'seeded')

    let probed = false
    globalThis.fetch = (async () => {
      probed = true
      return new Response('', { status: 200 })
    }) as typeof fetch

    await warmContextWindowCache('https://example/v1', 'm')
    expect(probed).toBe(false)
    expect(getCachedContextWindow('https://example/v1', 'm')).toBe(100)
  })

  test('probes and caches when no entry exists', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ id: 'm', context_length: 4096 }),
        { headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    await warmContextWindowCache('https://example/v1', 'm')
    expect(getCachedContextWindow('https://example/v1', 'm')).toBe(4096)
  })

  test('no-ops on empty baseUrl or model', async () => {
    let probed = false
    globalThis.fetch = (async () => {
      probed = true
      return new Response('{}')
    }) as typeof fetch

    await warmContextWindowCache('', 'm')
    await warmContextWindowCache('https://example/v1', '')
    expect(probed).toBe(false)
  })
})

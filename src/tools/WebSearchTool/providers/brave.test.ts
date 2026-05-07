import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { braveProvider } from './brave.ts'

const originalEnv = {
  BRAVE_API_KEY: process.env.BRAVE_API_KEY,
}

const originalFetch = globalThis.fetch

afterEach(() => {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  globalThis.fetch = originalFetch
})

describe('braveProvider isConfigured', () => {
  test('true when BRAVE_API_KEY is set', () => {
    process.env.BRAVE_API_KEY = 'brv-test-key'
    expect(braveProvider.isConfigured()).toBe(true)
  })

  test('false when BRAVE_API_KEY is missing', () => {
    delete process.env.BRAVE_API_KEY
    expect(braveProvider.isConfigured()).toBe(false)
  })
})

describe('braveProvider search', () => {
  beforeEach(() => {
    process.env.BRAVE_API_KEY = 'brv-test-key'
  })

  test('sends bare token in X-Subscription-Token (no Bearer prefix)', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedUrl = ''
    globalThis.fetch = (async (input: any, init: any) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })
    }) as typeof fetch

    await braveProvider.search({ query: 'hello' })

    expect(capturedHeaders['X-Subscription-Token']).toBe('brv-test-key')
    expect(capturedUrl).toContain('https://api.search.brave.com/res/v1/web/search')
    expect(capturedUrl).toContain('q=hello')
  })

  test('maps web.results into SearchHit shape', async () => {
    globalThis.fetch = (async (_input: any, _init: any) => new Response(JSON.stringify({
      web: {
        results: [
          { title: 'Example', url: 'https://example.com/a', description: 'snippet a' },
          { title: 'Other',   url: 'https://other.com/b',   description: 'snippet b' },
        ],
      },
    }), { status: 200 })) as typeof fetch

    const out = await braveProvider.search({ query: 'hello' })

    expect(out.providerName).toBe('brave')
    expect(out.hits).toHaveLength(2)
    expect(out.hits[0]).toEqual({
      title: 'Example',
      url: 'https://example.com/a',
      description: 'snippet a',
      source: 'example.com',
    })
  })

  test('applies blocked_domains client-side', async () => {
    globalThis.fetch = (async (_input: any, _init: any) => new Response(JSON.stringify({
      web: {
        results: [
          { title: 'Keep', url: 'https://keep.com/a', description: 'k' },
          { title: 'Drop', url: 'https://drop.com/b', description: 'd' },
        ],
      },
    }), { status: 200 })) as typeof fetch

    const out = await braveProvider.search({ query: 'q', blocked_domains: ['drop.com'] })
    expect(out.hits).toHaveLength(1)
    expect(out.hits[0].url).toBe('https://keep.com/a')
  })

  test('throws on non-2xx response with status code', async () => {
    globalThis.fetch = (async (_input: any, _init: any) =>
      new Response('rate limited', { status: 429 })) as typeof fetch
    await expect(braveProvider.search({ query: 'q' })).rejects.toThrow(/429/)
  })

  test('returns empty hits when web.results is missing', async () => {
    globalThis.fetch = (async (_input: any, _init: any) =>
      new Response(JSON.stringify({}), { status: 200 })) as typeof fetch
    const out = await braveProvider.search({ query: 'q' })
    expect(out.hits).toHaveLength(0)
  })
})

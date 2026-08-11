import { afterEach, describe, expect, mock, test } from 'bun:test'

import { asMockFetch } from '../../test/typedMocks.js'
import { firecrawlScrape, firecrawlSearch } from './client.js'

const originalFetch = globalThis.fetch
const originalEnv = {
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  FIRECRAWL_API_URL: process.env.FIRECRAWL_API_URL,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  restoreEnv('FIRECRAWL_API_KEY', originalEnv.FIRECRAWL_API_KEY)
  restoreEnv('FIRECRAWL_API_URL', originalEnv.FIRECRAWL_API_URL)
})

describe('firecrawl client', () => {
  test('search posts to the v2 API with bearer auth', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key'
    delete process.env.FIRECRAWL_API_URL

    globalThis.fetch = asMockFetch(mock(async (input, init) => {
      expect(String(input)).toBe('https://api.firecrawl.dev/v2/search')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer fc-test-key')

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        query: 'openclaude',
        limit: 7,
        origin: 'openclaude',
      })

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [{ url: 'https://example.com', title: 'Example', description: 'desc' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(firecrawlSearch('openclaude', { limit: 7 })).resolves.toEqual({
      web: [{ url: 'https://example.com', title: 'Example', description: 'desc' }],
    })
  })

  test('scrape allows self-hosted api urls without an api key', async () => {
    delete process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_URL = 'https://self-hosted.firecrawl.dev'

    globalThis.fetch = asMockFetch(mock(async (input, init) => {
      expect(String(input)).toBe('https://self-hosted.firecrawl.dev/v2/scrape')
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        url: 'https://example.com',
        formats: ['markdown'],
        origin: 'openclaude',
      })

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: '# Example',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(firecrawlScrape('https://example.com')).resolves.toEqual({
      markdown: '# Example',
    })
  })

  test('allows proxy api urls containing the cloud hostname in the path without an api key', async () => {
    delete process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_URL = 'https://proxy.example.com/api.firecrawl.dev'

    globalThis.fetch = asMockFetch(mock(async (input, init) => {
      expect(String(input)).toBe('https://proxy.example.com/api.firecrawl.dev/v2/search')
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [{ url: 'https://example.com/proxy' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(firecrawlSearch('openclaude', { maxRetries: 1 })).resolves.toEqual({
      web: [{ url: 'https://example.com/proxy' }],
    })
  })

  test('cloud api requires an api key', async () => {
    delete process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_URL

    await expect(firecrawlSearch('openclaude')).rejects.toThrow(
      'Firecrawl API key is required for the cloud API.',
    )
  })

  test('bare cloud api host requires an api key case-insensitively', async () => {
    for (const apiUrl of ['API.FIRECRAWL.DEV', 'API.FIRECRAWL.DEV/']) {
      delete process.env.FIRECRAWL_API_KEY
      process.env.FIRECRAWL_API_URL = apiUrl

      globalThis.fetch = asMockFetch(mock(async () => {
        return new Response(JSON.stringify({ success: true, data: { web: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }))

      await expect(firecrawlSearch('openclaude')).rejects.toThrow(
        'Firecrawl API key is required for the cloud API.',
      )
    }
  })

  test('retries transient 502 responses before succeeding', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key'
    delete process.env.FIRECRAWL_API_URL

    let attempts = 0
    globalThis.fetch = asMockFetch(mock(async () => {
      attempts += 1
      if (attempts < 3) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'temporary upstream failure',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        )
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [{ url: 'https://example.com/retried' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(
      firecrawlSearch('openclaude', { maxRetries: 3, backoffFactorSeconds: 0 }),
    ).resolves.toEqual({
      web: [{ url: 'https://example.com/retried' }],
    })
    expect(attempts).toBe(3)
  })

  test('aborts in-flight requests when the request timeout elapses', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key'
    delete process.env.FIRECRAWL_API_URL

    globalThis.fetch = asMockFetch(mock(async (_input, init) => {
      const signal = init?.signal
      expect(signal).toBeInstanceOf(AbortSignal)

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      })
    }))

    await expect(
      Promise.race([
        firecrawlSearch('openclaude', { maxRetries: 1, timeoutMs: 1 }),
        new Promise((_resolve, reject) =>
          setTimeout(
            reject,
            100,
            new Error('Firecrawl request timeout did not abort'),
          ),
        ),
      ]),
    ).rejects.toThrow('The operation timed out.')
  })

  test('cleans up request timeout after a successful response', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key'
    delete process.env.FIRECRAWL_API_URL

    let requestSignal: AbortSignal | undefined
    globalThis.fetch = asMockFetch(mock(async (_input, init) => {
      requestSignal = init?.signal
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [{ url: 'https://example.com/cleanup' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(
      firecrawlSearch('openclaude', { maxRetries: 1, timeoutMs: 20 }),
    ).resolves.toEqual({
      web: [{ url: 'https://example.com/cleanup' }],
    })

    await new Promise(resolve => setTimeout(resolve, 40))
    expect(requestSignal?.aborted).toBe(false)
  })
})

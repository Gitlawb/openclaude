import { afterEach, describe, expect, mock, test } from 'bun:test'

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

    globalThis.fetch = mock(async (input, init) => {
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
    }) as typeof globalThis.fetch

    await expect(firecrawlSearch('openclaude', { limit: 7 })).resolves.toEqual({
      web: [{ url: 'https://example.com', title: 'Example', description: 'desc' }],
    })
  })

  test('scrape allows self-hosted api urls without an api key', async () => {
    delete process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_URL = 'https://self-hosted.firecrawl.dev'

    globalThis.fetch = mock(async (input, init) => {
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
    }) as typeof globalThis.fetch

    await expect(firecrawlScrape('https://example.com')).resolves.toEqual({
      markdown: '# Example',
    })
  })

  test('cloud api requires an api key', async () => {
    delete process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_URL

    await expect(firecrawlSearch('openclaude')).rejects.toThrow(
      'Firecrawl API key is required for the cloud API.',
    )
  })

  test('retries transient 502 responses before succeeding', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key'
    delete process.env.FIRECRAWL_API_URL

    let attempts = 0
    globalThis.fetch = mock(async () => {
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
    }) as typeof globalThis.fetch

    await expect(
      firecrawlSearch('openclaude', { maxRetries: 3, backoffFactorSeconds: 0 }),
    ).resolves.toEqual({
      web: [{ url: 'https://example.com/retried' }],
    })
    expect(attempts).toBe(3)
  })
})

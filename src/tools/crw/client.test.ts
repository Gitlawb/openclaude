import { afterEach, describe, expect, mock, test } from 'bun:test'

import { asMockFetch } from '../../test/typedMocks.js'
import { crwScrape, crwSearch } from './client.js'

const originalFetch = globalThis.fetch
const originalEnv = {
  CRW_API_KEY: process.env.CRW_API_KEY,
  CRW_API_URL: process.env.CRW_API_URL,
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
  restoreEnv('CRW_API_KEY', originalEnv.CRW_API_KEY)
  restoreEnv('CRW_API_URL', originalEnv.CRW_API_URL)
})

describe('crw client', () => {
  test('search posts to the v1 API with bearer auth', async () => {
    process.env.CRW_API_KEY = 'crw-test-key'
    delete process.env.CRW_API_URL

    globalThis.fetch = asMockFetch(mock(async (input, init) => {
      expect(String(input)).toBe('https://fastcrw.com/api/v1/search')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer crw-test-key')

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        query: 'openclaude',
        limit: 7,
        origin: 'openclaude',
      })

      return new Response(
        JSON.stringify({
          success: true,
          data: [{ url: 'https://example.com', title: 'Example', description: 'desc' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(crwSearch('openclaude', { limit: 7 })).resolves.toEqual([
      { url: 'https://example.com', title: 'Example', description: 'desc' },
    ])
  })

  test('scrape allows self-hosted api urls without an api key', async () => {
    delete process.env.CRW_API_KEY
    process.env.CRW_API_URL = 'http://localhost:3000'

    globalThis.fetch = asMockFetch(mock(async (input, init) => {
      expect(String(input)).toBe('http://localhost:3000/v1/scrape')
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

    await expect(crwScrape('https://example.com')).resolves.toEqual({
      markdown: '# Example',
    })
  })

  test('cloud api requires an api key', async () => {
    delete process.env.CRW_API_KEY
    delete process.env.CRW_API_URL

    await expect(crwSearch('openclaude')).rejects.toThrow(
      'fastCRW API key is required for the cloud API.',
    )
  })

  test('retries transient 502 responses before succeeding', async () => {
    process.env.CRW_API_KEY = 'crw-test-key'
    delete process.env.CRW_API_URL

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
          data: [{ url: 'https://example.com/retried' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(
      crwSearch('openclaude', { maxRetries: 3, backoffFactorSeconds: 0 }),
    ).resolves.toEqual([{ url: 'https://example.com/retried' }])
    expect(attempts).toBe(3)
  })

  test('aborts in-flight requests when the request timeout elapses', async () => {
    process.env.CRW_API_KEY = 'crw-test-key'
    delete process.env.CRW_API_URL

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
        crwSearch('openclaude', { maxRetries: 1, timeoutMs: 1 }),
        new Promise((_resolve, reject) =>
          setTimeout(
            reject,
            100,
            new Error('fastCRW request timeout did not abort'),
          ),
        ),
      ]),
    ).rejects.toThrow('The operation timed out.')
  })

  test('cleans up request timeout after a successful response', async () => {
    process.env.CRW_API_KEY = 'crw-test-key'
    delete process.env.CRW_API_URL

    let requestSignal: AbortSignal | undefined
    globalThis.fetch = asMockFetch(mock(async (_input, init) => {
      requestSignal = init?.signal
      return new Response(
        JSON.stringify({
          success: true,
          data: [{ url: 'https://example.com/cleanup' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    await expect(
      crwSearch('openclaude', { maxRetries: 1, timeoutMs: 20 }),
    ).resolves.toEqual([{ url: 'https://example.com/cleanup' }])

    await new Promise(resolve => setTimeout(resolve, 40))
    expect(requestSignal?.aborted).toBe(false)
  })
})

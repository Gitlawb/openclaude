import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../../test/sharedMutationLock.js'
import { ollamaProvider } from './ollama.js'

const originalFetch = globalThis.fetch
const savedEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function clearOllamaEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OLLAMA_BASE_URL
  delete process.env.OLLAMA_API_KEY
}

beforeEach(async () => {
  await acquireSharedMutationLock('WebSearchTool/providers/ollama.test.ts')
  clearOllamaEnv()
})

afterEach(() => {
  try {
    restoreEnv()
    globalThis.fetch = originalFetch
  } finally {
    releaseSharedMutationLock()
  }
})

describe('ollamaProvider', () => {
  test('is configured for the active Ollama route or a hosted API key', () => {
    expect(ollamaProvider.isConfigured()).toBe(false)

    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    expect(ollamaProvider.isConfigured()).toBe(true)

    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.OPENAI_BASE_URL
    process.env.OLLAMA_API_KEY = 'ollama-test-key'
    expect(ollamaProvider.isConfigured()).toBe(true)
  })

  test('uses the signed-in local endpoint and maps structured results', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

    let requestUrl = ''
    let requestInit: RequestInit | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestInit = init
      return Response.json({
        results: [
          {
            title: 'Ollama result',
            url: 'https://docs.ollama.com/capabilities/web-search',
            content: 'Structured result content',
          },
        ],
      })
    }) as typeof fetch

    const output = await ollamaProvider.search({ query: 'ollama search' })

    expect(requestUrl).toBe(
      'http://localhost:11434/api/experimental/web_search',
    )
    expect(requestInit?.headers).toEqual({
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      query: 'ollama search',
      max_results: 10,
    })
    expect(output.providerName).toBe('ollama')
    expect(output.hits).toEqual([
      {
        title: 'Ollama result',
        url: 'https://docs.ollama.com/capabilities/web-search',
        description: 'Structured result content',
        source: 'docs.ollama.com',
      },
    ])
  })

  test('falls back from local Ollama to the authenticated hosted API', async () => {
    process.env.OLLAMA_BASE_URL = 'http://ollama.internal:11434/v1/'
    process.env.OLLAMA_API_KEY = 'ollama-test-key'

    const requests: Array<{ url: string; headers: Headers }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
      })
      if (requests.length === 1) {
        return Response.json({ results: [] })
      }
      return Response.json({
        results: [
          {
            title: 'Hosted result',
            url: 'https://example.com/result',
            content: 'Hosted content',
          },
        ],
      })
    }) as typeof fetch

    const output = await ollamaProvider.search({ query: 'fallback' })

    expect(requests.map(request => request.url)).toEqual([
      'http://ollama.internal:11434/api/experimental/web_search',
      'https://ollama.com/api/web_search',
    ])
    expect(requests[0].headers.has('Authorization')).toBe(false)
    expect(requests[1].headers.get('Authorization')).toBe(
      'Bearer ollama-test-key',
    )
    expect(output.hits[0]?.title).toBe('Hosted result')
  })

  test('applies shared domain filters to Ollama results', async () => {
    process.env.OLLAMA_API_KEY = 'ollama-test-key'
    globalThis.fetch = (async () =>
      Response.json({
        results: [
          { title: 'Keep', url: 'https://docs.ollama.com/search', content: 'a' },
          { title: 'Drop', url: 'https://example.com/search', content: 'b' },
        ],
      })) as unknown as typeof fetch

    const output = await ollamaProvider.search({
      query: 'domains',
      allowed_domains: ['ollama.com'],
    })

    expect(output.hits.map(hit => hit.title)).toEqual(['Keep'])
  })

  test('does not try hosted fallback after caller cancellation', async () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OLLAMA_API_KEY = 'ollama-test-key'
    const controller = new AbortController()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    }) as unknown as typeof fetch

    await expect(
      ollamaProvider.search({ query: 'cancel' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })
})

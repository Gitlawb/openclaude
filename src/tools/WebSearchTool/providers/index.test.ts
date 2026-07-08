import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../../test/sharedMutationLock.js'
import { getProviderMode, getProviderChain, getAvailableProviders } from './index.js'
import type { ProviderMode } from './index.js'

const savedWebSearchEnv = {
  WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER,
  WEB_SEARCH_TIMEOUT_SEC: process.env.WEB_SEARCH_TIMEOUT_SEC,
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  FIRECRAWL_API_URL: process.env.FIRECRAWL_API_URL,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  EXA_API_KEY: process.env.EXA_API_KEY,
  YOU_API_KEY: process.env.YOU_API_KEY,
  JINA_API_KEY: process.env.JINA_API_KEY,
  BRAVE_API_KEY: process.env.BRAVE_API_KEY,
  BING_API_KEY: process.env.BING_API_KEY,
  MOJEEK_API_KEY: process.env.MOJEEK_API_KEY,
  LINKUP_API_KEY: process.env.LINKUP_API_KEY,
}

const originalFetch = globalThis.fetch
const originalConsoleError = console.error

function restoreWebSearchEnv() {
  for (const [key, value] of Object.entries(savedWebSearchEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('WebSearchTool/providers/index.test.ts')
})

afterEach(() => {
  try {
    restoreWebSearchEnv()
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

function configureAutoModeWithOnlyBrave(): void {
  process.env.WEB_SEARCH_PROVIDER = 'auto'
  delete process.env.FIRECRAWL_API_KEY
  delete process.env.FIRECRAWL_API_URL
  delete process.env.TAVILY_API_KEY
  delete process.env.EXA_API_KEY
  delete process.env.YOU_API_KEY
  delete process.env.JINA_API_KEY
  process.env.BRAVE_API_KEY = 'brv-test-key'
  delete process.env.BING_API_KEY
  delete process.env.MOJEEK_API_KEY
  delete process.env.LINKUP_API_KEY
}

function mockDuckDuckGoSearch(
  search: () => Promise<{
    results: Array<{ title: string; url: string; description?: string }>
  }>,
): void {
  mock.module('duck-duck-scrape', () => ({
    SafeSearchType: {
      STRICT: 0,
      MODERATE: -1,
      OFF: -2,
    },
    search,
  }))
}

function stalledJsonResponse(): Response {
  return new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// getProviderMode
// ---------------------------------------------------------------------------

describe('getProviderMode', () => {
  test('returns auto by default', () => {
    delete process.env.WEB_SEARCH_PROVIDER
    expect(getProviderMode()).toBe('auto')
  })

  test('returns configured mode', () => {
    process.env.WEB_SEARCH_PROVIDER = 'tavily'
    expect(getProviderMode()).toBe('tavily')
  })

  test('returns ddg mode', () => {
    process.env.WEB_SEARCH_PROVIDER = 'ddg'
    expect(getProviderMode()).toBe('ddg')
  })

  test('returns native mode', () => {
    process.env.WEB_SEARCH_PROVIDER = 'native'
    expect(getProviderMode()).toBe('native')
  })

  test('falls back to auto for invalid mode', () => {
    process.env.WEB_SEARCH_PROVIDER = 'nonexistent_provider'
    expect(getProviderMode()).toBe('auto')
  })
})

// ---------------------------------------------------------------------------
// getProviderChain
// ---------------------------------------------------------------------------

describe('getProviderChain', () => {
  test('auto mode returns at least one configured provider', () => {
    // DDG isAlways configured (no API key needed)
    const chain = getProviderChain('auto')
    expect(chain.length).toBeGreaterThan(0)
    expect(chain.some(p => p.name === 'duckduckgo')).toBe(true)
  })

  test('auto mode does NOT include custom provider', () => {
    const chain = getProviderChain('auto')
    expect(chain.some(p => p.name === 'custom')).toBe(false)
  })

  test('custom mode explicitly returns custom provider', () => {
    const chain = getProviderChain('custom' as ProviderMode)
    expect(chain).toHaveLength(1)
    expect(chain[0].name).toBe('custom')
  })

  test('specific mode returns exactly one provider', () => {
    const chain = getProviderChain('tavily' as ProviderMode)
    expect(chain).toHaveLength(1)
    expect(chain[0].name).toBe('tavily')
  })

  test('ddg mode returns duckduckgo provider', () => {
    const chain = getProviderChain('ddg' as ProviderMode)
    expect(chain).toHaveLength(1)
    expect(chain[0].name).toBe('duckduckgo')
  })

  test('native mode returns empty chain', () => {
    expect(getProviderChain('native')).toHaveLength(0)
  })

  test('unknown mode returns empty chain', () => {
    expect(getProviderChain('nonexistent' as ProviderMode)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// AbortError stops the chain
// ---------------------------------------------------------------------------

describe('runSearch', () => {
  test('AbortError stops the chain immediately in auto mode', async () => {
    // Use AbortController to cancel
    const controller = new AbortController()
    controller.abort() // cancel immediately

    await expect(
      // Dynamic import to avoid circular issues
      import('./index.js').then(m =>
        m.runSearch({ query: 'test' }, controller.signal),
      ),
    ).rejects.toThrow()
  })

  test('explicit mode fails fast when provider is not configured', async () => {
    // Save and clear tavily key
    const saved = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY
    const savedProvider = process.env.WEB_SEARCH_PROVIDER
    process.env.WEB_SEARCH_PROVIDER = 'tavily'

    try {
      const { runSearch } = await import('./index.js')
      await expect(runSearch({ query: 'test' })).rejects.toThrow(
        /not configured/i,
      )
    } finally {
      if (saved !== undefined) process.env.TAVILY_API_KEY = saved
      else delete process.env.TAVILY_API_KEY
      if (savedProvider !== undefined) process.env.WEB_SEARCH_PROVIDER = savedProvider
      else delete process.env.WEB_SEARCH_PROVIDER
    }
  })

  test('auto mode falls through when a provider times out', async () => {
    configureAutoModeWithOnlyBrave()
    process.env.WEB_SEARCH_TIMEOUT_SEC = '1'
    console.error = () => {}
    globalThis.fetch = (async (_input: any, _init: any) =>
      new Promise<Response>(() => undefined)) as typeof fetch
    mockDuckDuckGoSearch(async () => ({
      results: [
        {
          title: 'Fallback result',
          url: 'https://example.com/fallback',
          description: 'from ddg',
        },
      ],
    }))

    const { runSearch } = await import('./index.js')
    const output = await runSearch({ query: 'timeout fallback' })

    expect(output.providerName).toBe('duckduckgo')
    expect(output.hits).toHaveLength(1)
    expect(output.hits[0].title).toBe('Fallback result')
  })

  test('auto mode falls through when a provider response body stalls', async () => {
    configureAutoModeWithOnlyBrave()
    process.env.WEB_SEARCH_TIMEOUT_SEC = '1'
    console.error = () => {}
    globalThis.fetch = (async (_input: any, _init?: any) =>
      stalledJsonResponse()) as unknown as typeof fetch
    mockDuckDuckGoSearch(async () => ({
      results: [
        {
          title: 'Body fallback result',
          url: 'https://example.com/body-fallback',
          description: 'from ddg',
        },
      ],
    }))

    const { runSearch } = await import('./index.js')
    const output = await runSearch({ query: 'body timeout fallback' })

    expect(output.providerName).toBe('duckduckgo')
    expect(output.hits).toHaveLength(1)
    expect(output.hits[0].title).toBe('Body fallback result')
  })

  test('auto mode does not fall through after caller abort', async () => {
    configureAutoModeWithOnlyBrave()
    process.env.WEB_SEARCH_TIMEOUT_SEC = '1'

    let fetchCalls = 0
    globalThis.fetch = (async (_input: any, _init: any) => {
      fetchCalls++
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })
    }) as typeof fetch

    let duckDuckGoCalls = 0
    mockDuckDuckGoSearch(async () => {
      duckDuckGoCalls++
      return { results: [] }
    })

    const controller = new AbortController()
    controller.abort()

    const { runSearch } = await import('./index.js')
    await expect(
      runSearch({ query: 'user abort' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(fetchCalls).toBe(0)
    expect(duckDuckGoCalls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getAvailableProviders
// ---------------------------------------------------------------------------

describe('getAvailableProviders', () => {
  test('always includes duckduckgo (no API key required)', () => {
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'duckduckgo')).toBe(true)
  })

  test('does NOT include custom in available providers (auto chain)', () => {
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'custom')).toBe(false)
  })

  test('includes providers when API keys are set', () => {
    const saved = process.env.TAVILY_API_KEY
    process.env.TAVILY_API_KEY = 'test-key'
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'tavily')).toBe(true)
    if (saved === undefined) delete process.env.TAVILY_API_KEY
    else process.env.TAVILY_API_KEY = saved
  })

  test('excludes providers when API keys are missing', () => {
    const saved = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'tavily')).toBe(false)
    if (saved !== undefined) process.env.TAVILY_API_KEY = saved
  })
})

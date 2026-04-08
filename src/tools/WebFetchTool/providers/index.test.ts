import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { getProviderMode, getProviderChain, getAvailableProviders, runFetch } from './index.js'
import type { ProviderMode } from './index.js'

// ---------------------------------------------------------------------------
// getProviderMode
// ---------------------------------------------------------------------------

describe('getProviderMode', () => {
  const savedEnv = process.env.WEB_FETCH_PROVIDER

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.WEB_FETCH_PROVIDER
    else process.env.WEB_FETCH_PROVIDER = savedEnv
  })

  test('returns auto by default', () => {
    delete process.env.WEB_FETCH_PROVIDER
    expect(getProviderMode()).toBe('auto')
  })

  test('returns configured mode', () => {
    process.env.WEB_FETCH_PROVIDER = 'jina'
    expect(getProviderMode()).toBe('jina')
  })

  test('returns ddg mode', () => {
    process.env.WEB_FETCH_PROVIDER = 'ddg'
    expect(getProviderMode()).toBe('ddg')
  })

  test('returns firecrawl mode', () => {
    process.env.WEB_FETCH_PROVIDER = 'firecrawl'
    expect(getProviderMode()).toBe('firecrawl')
  })

  test('falls back to auto for invalid mode', () => {
    process.env.WEB_FETCH_PROVIDER = 'nonexistent_provider'
    expect(getProviderMode()).toBe('auto')
  })
})

// ---------------------------------------------------------------------------
// getProviderChain
// ---------------------------------------------------------------------------

describe('getProviderChain', () => {
  test('auto mode returns at least one configured provider', () => {
    // default and jina are always configured (no API key needed)
    const chain = getProviderChain('auto')
    expect(chain.length).toBeGreaterThan(0)
    expect(chain.some(p => p.name === 'default')).toBe(true)
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
    const chain = getProviderChain('jina' as ProviderMode)
    expect(chain).toHaveLength(1)
    expect(chain[0].name).toBe('jina')
  })

  test('ddg mode returns ddg provider', () => {
    const chain = getProviderChain('ddg' as ProviderMode)
    expect(chain).toHaveLength(1)
    expect(chain[0].name).toBe('ddg')
  })

  test('unknown mode returns empty chain', () => {
    expect(getProviderChain('nonexistent' as ProviderMode)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// getAvailableProviders
// ---------------------------------------------------------------------------

describe('getAvailableProviders', () => {
  test('always includes default (no API key required)', () => {
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'default')).toBe(true)
  })

  test('always includes jina (no API key required)', () => {
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'jina')).toBe(true)
  })

  test('always includes ddg (no API key required)', () => {
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'ddg')).toBe(true)
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

  test('includes firecrawl when key is set', () => {
    const saved = process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_KEY = 'test-key'
    const providers = getAvailableProviders()
    expect(providers.some(p => p.name === 'firecrawl')).toBe(true)
    if (saved === undefined) delete process.env.FIRECRAWL_API_KEY
    else process.env.FIRECRAWL_API_KEY = saved
  })
})

// ---------------------------------------------------------------------------
// runFetch
// ---------------------------------------------------------------------------

describe('runFetch', () => {
  test('AbortError stops the chain immediately in auto mode', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runFetch('https://example.com', controller.signal)).rejects.toThrow()
  })

  test('explicit mode fails fast when provider is not configured', async () => {
    const saved = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    const savedProvider = process.env.WEB_FETCH_PROVIDER
    process.env.WEB_FETCH_PROVIDER = 'firecrawl'

    try {
      await expect(runFetch('https://example.com')).rejects.toThrow(/not configured/i)
    } finally {
      if (saved !== undefined) process.env.FIRECRAWL_API_KEY = saved
      else delete process.env.FIRECRAWL_API_KEY
      if (savedProvider !== undefined) process.env.WEB_FETCH_PROVIDER = savedProvider
      else delete process.env.WEB_FETCH_PROVIDER
    }
  })

  test('default provider is in auto chain', () => {
    const chain = getProviderChain('auto')
    expect(chain.some(p => p.name === 'default')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Provider isConfigured
// ---------------------------------------------------------------------------

describe('provider isConfigured', () => {
  test('default is always configured', async () => {
    const { defaultProvider } = await import('./default.js')
    expect(defaultProvider.isConfigured()).toBe(true)
  })

  test('jina is always configured', async () => {
    const { jinaProvider } = await import('./jina.js')
    expect(jinaProvider.isConfigured()).toBe(true)
  })

  test('ddg is always configured', async () => {
    const { ddgProvider } = await import('./ddg.js')
    expect(ddgProvider.isConfigured()).toBe(true)
  })

  test('firecrawl requires FIRECRAWL_API_KEY', async () => {
    const saved = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    const { firecrawlProvider } = await import('./firecrawl.js')
    expect(firecrawlProvider.isConfigured()).toBe(false)
    if (saved !== undefined) process.env.FIRECRAWL_API_KEY = saved
  })

  test('tavily requires TAVILY_API_KEY', async () => {
    const saved = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY
    const { tavilyProvider } = await import('./tavily.js')
    expect(tavilyProvider.isConfigured()).toBe(false)
    if (saved !== undefined) process.env.TAVILY_API_KEY = saved
  })

  test('custom requires WEB_FETCH_API', async () => {
    const saved = process.env.WEB_FETCH_API
    delete process.env.WEB_FETCH_API
    const { customProvider } = await import('./custom.js')
    expect(customProvider.isConfigured()).toBe(false)
    if (saved !== undefined) process.env.WEB_FETCH_API = saved
  })
})

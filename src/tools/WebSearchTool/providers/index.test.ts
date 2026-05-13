import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { getProviderMode, getProviderChain, getAvailableProviders } from './index.js'
import type { ProviderMode } from './index.js'

// ---------------------------------------------------------------------------
// getProviderMode
// ---------------------------------------------------------------------------

describe('getProviderMode', () => {
  const savedEnv = process.env.WEB_SEARCH_PROVIDER

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.WEB_SEARCH_PROVIDER
    } else {
      process.env.WEB_SEARCH_PROVIDER = savedEnv
    }
  })

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

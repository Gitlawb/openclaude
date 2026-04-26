import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { registerGateway } from './index.js'

const originalFetch = globalThis.fetch
const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
}

let tempDir: string

async function loadDiscoveryServiceModule() {
  return import(`./discoveryService.js?ts=${Date.now()}-${Math.random()}`)
}

function setMockFetch(
  implementation: typeof globalThis.fetch,
): void {
  globalThis.fetch = implementation
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-discovery-service-test-'))
  process.env.CLAUDE_CONFIG_DIR = tempDir
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.CLAUDE_CODE_USE_OPENAI
  globalThis.fetch = originalFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
  if (originalEnv.CLAUDE_CONFIG_DIR === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalEnv.CLAUDE_CONFIG_DIR
  }
  if (originalEnv.OPENROUTER_API_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY
  } else {
    process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY
  }
  if (originalEnv.OPENAI_BASE_URL === undefined) {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  }
  if (originalEnv.CLAUDE_CODE_USE_OPENAI === undefined) {
    delete process.env.CLAUDE_CODE_USE_OPENAI
  } else {
    process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  }
})

describe('discoverModelsForRoute', () => {
  test('uses built-in openai-compatible discovery and caches results for dynamic routes', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    let callCount = 0
    setMockFetch(mock((input: string | URL | Request, init?: RequestInit) => {
      callCount++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      expect(url).toBe('http://127.0.0.1:1337/v1/models')
      expect(init?.headers).toBeUndefined()

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'Qwen3_5-4B_Q4_K_M' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const first = await discoverModelsForRoute('atomic-chat')
    const second = await discoverModelsForRoute('atomic-chat')

    expect(first).toMatchObject({
      routeId: 'atomic-chat',
      source: 'network',
      stale: false,
      models: [{ id: 'Qwen3_5-4B_Q4_K_M', apiName: 'Qwen3_5-4B_Q4_K_M' }],
    })
    expect(second?.source).toBe('cache')
    expect(callCount).toBe(1)
  })

  test('preserves stale cache data when refresh fails', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    setMockFetch(mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            models: [{ name: 'llama3.1:8b', size: 1024 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    ) as unknown as typeof globalThis.fetch)

    const first = await discoverModelsForRoute('ollama', { forceRefresh: true })
    expect(first?.source).toBe('network')

    setMockFetch(mock(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    ) as unknown as typeof globalThis.fetch)

    const second = await discoverModelsForRoute('ollama', { forceRefresh: true })
    expect(second).toMatchObject({
      source: 'stale-cache',
      stale: true,
      models: [{ id: 'llama3.1:8b', apiName: 'llama3.1:8b' }],
    })
    expect(second?.error?.message).toContain('Discovery failed')
  })

  test('hybrid routes keep curated descriptor entries ahead of discovered duplicates', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    process.env.OPENROUTER_API_KEY = 'or-key'
    setMockFetch(mock((_input, init) => {
      expect(init?.headers).toEqual({ Authorization: 'Bearer or-key' })
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { id: 'openai/gpt-5-mini' },
              { id: 'anthropic/claude-sonnet-4' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('openrouter', {
      forceRefresh: true,
    })

    expect(result?.models.map((model: { apiName: string }) => model.apiName)).toEqual([
      'openai/gpt-5-mini',
      'anthropic/claude-sonnet-4',
    ])
    expect(result?.models[0]?.label).toBe('GPT-5 Mini (via OpenRouter)')
  })

  test('openai-compatible discovery applies descriptor static headers with auth', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    registerGateway({
      id: 'discovery-header-test',
      label: 'Discovery Header Test',
      category: 'hosted',
      defaultBaseUrl: 'https://discovery-header-test.example/v1',
      setup: {
        requiresAuth: true,
        authMode: 'api-key',
        credentialEnvVars: ['DISCOVERY_HEADER_TEST_API_KEY'],
      },
      transportConfig: {
        kind: 'openai-compatible',
        openaiShim: {
          headers: {
            'X-Static-Client': 'openclaude',
          },
        },
      },
      catalog: {
        source: 'dynamic',
        discovery: {
          kind: 'openai-compatible',
        },
      },
    })

    setMockFetch(mock((_input, init) => {
      expect(init?.headers).toEqual({
        'X-Static-Client': 'openclaude',
        Authorization: 'Bearer discovery-key',
      })
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'discovered-model' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('discovery-header-test', {
      apiKey: 'discovery-key',
      forceRefresh: true,
    })

    expect(result?.source).toBe('network')
    expect(result?.models.map(model => model.apiName)).toEqual(['discovered-model'])
  })

  test('startup refresh mode performs discovery for startup routes and then reuses cache', async () => {
    const { refreshStartupDiscoveryForRoute } = await loadDiscoveryServiceModule()

    let callCount = 0
    setMockFetch(mock((input: string | URL | Request) => {
      callCount++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      expect(url).toBe('http://localhost:1234/v1/models')

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'local-model' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const first = await refreshStartupDiscoveryForRoute('lmstudio')
    const second = await refreshStartupDiscoveryForRoute('lmstudio')

    expect(first?.source).toBe('network')
    expect(first?.models.map(model => model.apiName)).toEqual(['local-model'])
    expect(second?.source).toBe('cache')
    expect(callCount).toBe(1)
  })

  test('refreshStartupDiscoveryForActiveRoute resolves the active startup route from env', async () => {
    const { refreshStartupDiscoveryForActiveRoute } =
      await loadDiscoveryServiceModule()

    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:1234/v1'

    setMockFetch(mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'local-model' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    ) as unknown as typeof globalThis.fetch)

    const result = await refreshStartupDiscoveryForActiveRoute({
      processEnv: process.env,
    })

    expect(result?.routeId).toBe('lmstudio')
    expect(result?.source).toBe('network')
  })
})

describe('probeRouteReadiness', () => {
  test('drives ollama readiness through descriptor metadata', async () => {
    const { probeRouteReadiness } = await loadDiscoveryServiceModule()

    setMockFetch(mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/api/tags')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [{ name: 'llama3.1:8b', size: 1024 }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'OK' },
            done: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    await expect(probeRouteReadiness('ollama')).resolves.toMatchObject({
      state: 'ready',
      probeModel: 'llama3.1:8b',
    })
  })

  test('drives atomic chat readiness through descriptor metadata', async () => {
    const { probeRouteReadiness } = await loadDiscoveryServiceModule()

    setMockFetch(mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'Qwen3_5-4B_Q4_K_M' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    ) as unknown as typeof globalThis.fetch)

    await expect(probeRouteReadiness('atomic-chat')).resolves.toEqual({
      state: 'ready',
      models: ['Qwen3_5-4B_Q4_K_M'],
    })
  })
})

describe('resolveDiscoveryRouteIdFromBaseUrl', () => {
  test('matches descriptor-backed routes by exact default base URL', async () => {
    const { resolveDiscoveryRouteIdFromBaseUrl } =
      await loadDiscoveryServiceModule()

    expect(
      resolveDiscoveryRouteIdFromBaseUrl('http://127.0.0.1:1337/v1'),
    ).toBe('atomic-chat')
    expect(
      resolveDiscoveryRouteIdFromBaseUrl('http://localhost:1234/v1'),
    ).toBe('lmstudio')
  })

  test('falls back to local-provider heuristics for Ollama aliases', async () => {
    const { resolveDiscoveryRouteIdFromBaseUrl } =
      await loadDiscoveryServiceModule()

    expect(
      resolveDiscoveryRouteIdFromBaseUrl('http://127.0.0.1:11434/v1'),
    ).toBe('ollama')
  })
})

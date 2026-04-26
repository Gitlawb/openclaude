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
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
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

function restoreEnvValue(
  key: keyof typeof originalEnv,
): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function clearProviderEnv(): void {
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
}

beforeEach(() => {
  mock.restore()
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-discovery-service-test-'))
  process.env.CLAUDE_CONFIG_DIR = tempDir
  delete process.env.OPENROUTER_API_KEY
  clearProviderEnv()
  globalThis.fetch = originalFetch
})

afterEach(() => {
  mock.restore()
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
  restoreEnvValue('CLAUDE_CONFIG_DIR')
  restoreEnvValue('OPENROUTER_API_KEY')
  restoreEnvValue('OPENAI_BASE_URL')
  restoreEnvValue('OPENAI_API_BASE')
  restoreEnvValue('OPENAI_MODEL')
  restoreEnvValue('CLAUDE_CODE_USE_OPENAI')
  restoreEnvValue('CLAUDE_CODE_USE_GEMINI')
  restoreEnvValue('CLAUDE_CODE_USE_MISTRAL')
  restoreEnvValue('CLAUDE_CODE_USE_GITHUB')
  restoreEnvValue('CLAUDE_CODE_USE_BEDROCK')
  restoreEnvValue('CLAUDE_CODE_USE_VERTEX')
  restoreEnvValue('CLAUDE_CODE_USE_FOUNDRY')
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

  test('partitions cached discovery results by endpoint base URL', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    let callCount = 0
    setMockFetch(mock((input: string | URL | Request) => {
      callCount++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const model = url.startsWith('http://remote-a.example/v1/')
        ? 'remote-a-model'
        : 'remote-b-model'

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: model }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const firstRemoteA = await discoverModelsForRoute('atomic-chat', {
      baseUrl: 'http://remote-a.example/v1',
    })
    const firstRemoteB = await discoverModelsForRoute('atomic-chat', {
      baseUrl: 'http://remote-b.example/v1',
    })
    const secondRemoteA = await discoverModelsForRoute('atomic-chat', {
      baseUrl: 'http://remote-a.example/v1',
    })

    expect(firstRemoteA?.source).toBe('network')
    expect(firstRemoteA?.models.map(model => model.apiName)).toEqual([
      'remote-a-model',
    ])
    expect(firstRemoteB?.source).toBe('network')
    expect(firstRemoteB?.models.map(model => model.apiName)).toEqual([
      'remote-b-model',
    ])
    expect(secondRemoteA?.source).toBe('cache')
    expect(secondRemoteA?.models.map(model => model.apiName)).toEqual([
      'remote-a-model',
    ])
    expect(callCount).toBe(2)
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
        'X-Static-Client': 'profile',
        'X-Profile-Header': 'enabled',
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
      headers: {
        'X-Static-Client': 'profile',
        'X-Profile-Header': 'enabled',
      },
      forceRefresh: true,
    })

    expect(result?.source).toBe('network')
    expect(result?.models.map((model: { apiName: string }) => model.apiName)).toEqual(['discovered-model'])
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
    expect(first?.models.map((model: { apiName: string }) => model.apiName)).toEqual(['local-model'])
    expect(second?.source).toBe('cache')
    expect(callCount).toBe(1)
  })

  test('refreshStartupDiscoveryForActiveRoute resolves the active startup route from env', async () => {
    const { refreshStartupDiscoveryForActiveRoute } =
      await loadDiscoveryServiceModule()

    const startupEnv: NodeJS.ProcessEnv = {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://localhost:1234/v1',
    }

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
      processEnv: startupEnv,
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

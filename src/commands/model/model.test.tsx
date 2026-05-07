import { afterEach, expect, mock, test } from 'bun:test'

import { getAdditionalModelOptionsCacheScope } from '../../services/api/providerConfig.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
}

async function importFreshModelModule(
  suffix: string,
): Promise<typeof import('./model.js')> {
  return import(`./model.js?${suffix}`) as Promise<
    typeof import('./model.js')
  >
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  mock.restore()
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
  restoreEnv('CLAUDE_CODE_USE_MISTRAL', originalEnv.CLAUDE_CODE_USE_MISTRAL)
  restoreEnv('CLAUDE_CODE_USE_BEDROCK', originalEnv.CLAUDE_CODE_USE_BEDROCK)
  restoreEnv('CLAUDE_CODE_USE_VERTEX', originalEnv.CLAUDE_CODE_USE_VERTEX)
  restoreEnv('CLAUDE_CODE_USE_FOUNDRY', originalEnv.CLAUDE_CODE_USE_FOUNDRY)
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_API_BASE', originalEnv.OPENAI_API_BASE)
  restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
  restoreEnv('OPENROUTER_API_KEY', originalEnv.OPENROUTER_API_KEY)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
  restoreEnv(
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    originalEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
  )
})

test('opens the model picker without awaiting local model discovery refresh', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_API_BASE
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8080/v1'
  process.env.OPENAI_MODEL = 'qwen2.5-coder-7b-instruct'

  const discoverOpenAICompatibleModelOptions = mock(
    async () => {
      await new Promise(resolve => setTimeout(resolve, 1_000))
      return []
    },
  )

  mock.module('../../utils/model/openaiModelDiscovery.js', () => ({
    discoverOpenAICompatibleModelOptions,
  }))

  expect(
    getAdditionalModelOptionsCacheScope()?.startsWith(
      'openai:http://127.0.0.1:8080/v1:',
    ),
  ).toBe(true)

  // Use a fresh module instance so per-test mocks stay local to this test.
  const { call } = await importFreshModelModule('local-discovery')
  const result = await Promise.race([
    call(() => {}, {} as never, ''),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
  ])

  expect(result).not.toBe('timeout')
})

test('opens the model picker without awaiting descriptor-backed route refresh', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'sk-openrouter'
  delete process.env.OPENROUTER_API_KEY
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_API_BASE

  mock.module('../../integrations/discoveryCache.js', () => ({
    clearDiscoveryCache: mock(async () => {}),
    getCachedModels: mock(async () => ({
      models: [{ id: 'cached-qwen', apiName: 'qwen/qwen3-32b' }],
      updatedAt: Date.now() - 86_400_000,
      error: null,
    })),
    isCacheStale: mock(async () => true),
    parseDurationString: (value: number | string) =>
      typeof value === 'number' ? value : 86_400_000,
  }))

  mock.module('../../integrations/discoveryService.js', () => ({
    getDiscoveryCacheKey: (
      routeId: string,
      options?: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> },
    ) => `${routeId}|${options?.baseUrl ?? ''}|${options?.apiKey ?? ''}|${JSON.stringify(options?.headers ?? {})}`,
    discoverModelsForRoute: mock(
      () =>
        new Promise(() => {
          // Intentionally unresolved; refresh should happen after the picker opens.
        }),
    ),
  }))

  mock.module('../../utils/providerProfiles.js', () => ({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => null,
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { call } = await importFreshModelModule('descriptor-refresh-open')
  const result = await Promise.race([
    call(() => {}, {} as never, ''),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
  ])

  expect(result).not.toBe('timeout')
})

test('shouldAutoRefreshRouteCatalog respects discovery refresh modes', async () => {
  const { shouldAutoRefreshRouteCatalog } =
    await importFreshModelModule('descriptor-refresh-modes')

  expect(
    shouldAutoRefreshRouteCatalog({
      catalog: {
        source: 'dynamic',
        discovery: { kind: 'openai-compatible' },
        discoveryRefreshMode: 'manual',
      },
      hasCachedModels: true,
      staticEntryCount: 0,
      stale: true,
    }),
  ).toBe(false)

  expect(
    shouldAutoRefreshRouteCatalog({
      catalog: {
        source: 'dynamic',
        discovery: { kind: 'openai-compatible' },
        discoveryRefreshMode: 'on-open',
      },
      hasCachedModels: true,
      staticEntryCount: 1,
      stale: false,
    }),
  ).toBe(true)

  expect(
    shouldAutoRefreshRouteCatalog({
      catalog: {
        source: 'dynamic',
        discovery: { kind: 'openai-compatible' },
        discoveryRefreshMode: 'startup',
      },
      hasCachedModels: true,
      staticEntryCount: 0,
      stale: true,
    }),
  ).toBe(false)
})

test('/model refresh clears descriptor cache and reports updates', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  delete process.env.OPENAI_API_KEY
  process.env.OPENROUTER_API_KEY = 'sk-openrouter-route'
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_API_BASE

  const clearDiscoveryCache = mock(async () => {})
  const getCachedModels = mock(async () => ({
    models: [{ id: 'cached-gpt', apiName: 'openai/gpt-5-mini' }],
    updatedAt: Date.now(),
    error: null,
  }))
  const isCacheStale = mock(async () => false)

  mock.module('../../integrations/discoveryCache.js', () => ({
    clearDiscoveryCache,
    getCachedModels,
    isCacheStale,
    parseDurationString: (value: number | string) =>
      typeof value === 'number' ? value : 86_400_000,
  }))

  mock.module('../../integrations/discoveryService.js', () => ({
    getDiscoveryCacheKey: (
      routeId: string,
      options?: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> },
    ) => `${routeId}|${options?.baseUrl ?? ''}|${options?.apiKey ?? ''}|${JSON.stringify(options?.headers ?? {})}`,
    discoverModelsForRoute: mock(async () => ({
      routeId: 'openrouter',
      models: [
        {
          id: 'openrouter-gpt-5-mini',
          apiName: 'openai/gpt-5-mini',
          default: true,
        },
        { id: 'openrouter-qwen', apiName: 'qwen/qwen3-32b' },
      ],
      stale: false,
      error: null,
      source: 'network',
    })),
  }))

  mock.module('../../utils/providerProfiles.js', () => ({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => null,
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const messages: string[] = []
  const { call } = await importFreshModelModule(
    'descriptor-refresh-manual',
  )
  await call(
    (message?: string) => {
      if (message) {
        messages.push(message)
      }
    },
    {} as never,
    'refresh',
  )

  const expectedCacheKey =
    'openrouter|https://openrouter.ai/api/v1|sk-openrouter-route|{}'
  expect(getCachedModels).toHaveBeenCalledWith(expectedCacheKey, 86_400_000, {
    includeStale: true,
  })
  expect(isCacheStale).toHaveBeenCalledWith(expectedCacheKey, 86_400_000)
  expect(clearDiscoveryCache).toHaveBeenCalledWith(expectedCacheKey)
  expect(messages).toContain('Updated OpenRouter models.')
})

test('/model does not auto-refresh descriptor models when nonessential traffic is disabled', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'sk-openrouter'
  delete process.env.OPENROUTER_API_KEY
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_API_BASE

  mock.module('../../integrations/discoveryCache.js', () => ({
    clearDiscoveryCache: mock(async () => {}),
    getCachedModels: mock(async () => null),
    isCacheStale: mock(async () => true),
    parseDurationString: (value: number | string) =>
      typeof value === 'number' ? value : 86_400_000,
  }))

  const discoverModelsForRoute = mock(async () => {
    throw new Error('unexpected descriptor discovery')
  })

  mock.module('../../integrations/discoveryService.js', () => ({
    getDiscoveryCacheKey: (
      routeId: string,
      options?: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> },
    ) => `${routeId}|${options?.baseUrl ?? ''}|${options?.apiKey ?? ''}|${JSON.stringify(options?.headers ?? {})}`,
    discoverModelsForRoute,
  }))

  mock.module('../../utils/providerProfiles.js', () => ({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => null,
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { call } = await importFreshModelModule('descriptor-privacy-open')
  const result = await call(() => {}, {} as never, '')

  expect(result).toBeTruthy()
  expect(discoverModelsForRoute).not.toHaveBeenCalled()
})

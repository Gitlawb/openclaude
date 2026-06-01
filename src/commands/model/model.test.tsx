import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { getAdditionalModelOptionsCacheScope } from '../../services/api/providerConfig.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

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
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
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

async function expectModelCommandDoesNotWaitForRefresh(
  commandPromise: Promise<unknown>,
): Promise<unknown> {
  const result = await Promise.race([
    commandPromise,
    new Promise(resolve =>
      setTimeout(() => resolve(Symbol.for('openclaude.test.timeout')), 1_000),
    ),
  ])

  expect(result).not.toBe(Symbol.for('openclaude.test.timeout'))
  return result
}

beforeEach(async () => {
  await acquireSharedMutationLock('commands/model/model.test.tsx')
})

afterEach(() => {
  try {
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
      'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
      originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
    )
    restoreEnv(
      'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
      originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
    )
    restoreEnv(
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      originalEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
    )
  } finally {
    releaseSharedMutationLock()
  }
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
  await expectModelCommandDoesNotWaitForRefresh(call(() => {}, {} as never, ''))
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
    getProfileModelOptions: () => [],
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { call } = await importFreshModelModule('descriptor-refresh-open')
  await expectModelCommandDoesNotWaitForRefresh(call(() => {}, {} as never, ''))
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

test('descriptor model options include active profile configured models', async () => {
  const activeProfile = {
    id: 'mistral-profile',
    name: 'Mistral AI',
    provider: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'devstral-latest, mistral-medium-latest',
    apiKey: 'sk-mistral',
  }
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID = activeProfile.id

  mock.module('../../utils/providerProfiles.js', () => ({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => activeProfile,
    getProfileModelOptions: () => [
      {
        value: 'devstral-latest',
        label: 'devstral-latest',
        description: 'Provider: Mistral AI',
      },
      {
        value: 'mistral-medium-latest',
        label: 'mistral-medium-latest',
        description: 'Provider: Mistral AI',
      },
    ],
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { mergeActiveProfileModelOptions } =
    await importFreshModelModule('descriptor-profile-model-merge')

  expect(
    mergeActiveProfileModelOptions(
      'mistral',
      [
        {
          value: 'devstral-latest',
          label: 'Devstral Latest',
          description: 'Recommended · Provider: Mistral AI',
        },
      ],
    ),
  ).toEqual([
    {
      value: 'devstral-latest',
      label: 'Devstral Latest',
      description: 'Recommended · Provider: Mistral AI',
    },
    {
      value: 'mistral-medium-latest',
      label: 'mistral-medium-latest',
      description: 'Provider: Mistral AI',
    },
  ])
})

test('descriptor model options omit route defaults outside active profile models', async () => {
  const activeProfile = {
    id: 'mistral-profile',
    name: 'Mistral AI',
    provider: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-medium-latest, mistral-small-latest',
    apiKey: 'sk-mistral',
  }
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID = activeProfile.id

  mock.module('../../utils/providerProfiles.js', () => ({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => activeProfile,
    getProfileModelOptions: () => [
      {
        value: 'mistral-medium-latest',
        label: 'mistral-medium-latest',
        description: 'Provider: Mistral AI',
      },
      {
        value: 'mistral-small-latest',
        label: 'mistral-small-latest',
        description: 'Provider: Mistral AI',
      },
    ],
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { mergeActiveProfileModelOptions } =
    await importFreshModelModule('descriptor-profile-model-filter')

  expect(
    mergeActiveProfileModelOptions(
      'mistral',
      [
        {
          value: 'devstral-latest',
          label: 'Devstral Latest',
          description: 'Recommended · Provider: Mistral AI',
        },
        {
          value: 'mistral-small-latest',
          label: 'Mistral Small Latest',
          description: 'Provider: Mistral AI',
        },
      ],
    ),
  ).toEqual([
    {
      value: 'mistral-medium-latest',
      label: 'mistral-medium-latest',
      description: 'Provider: Mistral AI',
    },
    {
      value: 'mistral-small-latest',
      label: 'Mistral Small Latest',
      description: 'Provider: Mistral AI',
    },
  ])
})

test('native vendor routes show the full catalog regardless of the profile model', async () => {
  const activeProfile = {
    id: 'minimax-profile',
    name: 'MiniMax',
    provider: 'minimax',
    baseUrl: 'https://api.minimax.io/anthropic',
    model: 'MiniMax-M2.7',
    apiKey: 'sk-minimax',
  }
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID = activeProfile.id

  mock.module('../../utils/providerProfiles.js', () => ({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => activeProfile,
    getProfileModelOptions: () => [
      {
        value: 'MiniMax-M2.7',
        label: 'MiniMax-M2.7',
        description: 'Provider: MiniMax',
      },
    ],
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { mergeActiveProfileModelOptions } =
    await importFreshModelModule('native-vendor-full-catalog')

  const routeOptions = [
    { value: 'MiniMax-M2.7', label: 'MiniMax M2.7', description: '256K context' },
    { value: 'MiniMax-M3', label: 'MiniMax M3', description: '1M context' },
  ]

  const merged = mergeActiveProfileModelOptions('minimax', routeOptions)
  const values = merged.map(option => option.value)

  // The whole catalog stays selectable — not just the profile's pinned model.
  expect(values).toContain('MiniMax-M2.7')
  expect(values).toContain('MiniMax-M3')
})

test('descriptor model options skip saved profile models for env-selected routes', async () => {
  const savedProfile = {
    id: 'mistral-profile',
    name: 'Mistral AI',
    provider: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'devstral-latest, mistral-medium-latest',
    apiKey: 'sk-mistral',
  }
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID

  mock.module('../../utils/providerProfiles.js', () => ({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => savedProfile,
    getProfileModelOptions: () => [
      {
        value: 'mistral-medium-latest',
        label: 'mistral-medium-latest',
        description: 'Provider: Mistral AI',
      },
    ],
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { mergeActiveProfileModelOptions } =
    await importFreshModelModule('descriptor-profile-model-env-skip')

  expect(
    mergeActiveProfileModelOptions(
      'openrouter',
      [
        {
          value: 'openai/gpt-5-mini',
          label: 'GPT-5 Mini',
          description: 'Provider: OpenRouter',
        },
      ],
    ),
  ).toEqual([
    {
      value: 'openai/gpt-5-mini',
      label: 'GPT-5 Mini',
      description: 'Provider: OpenRouter',
    },
  ])
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
    getProfileModelOptions: () => [],
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
    getProfileModelOptions: () => [],
    setActiveOpenAIModelOptionsCache: () => {},
  }))

  const { call } = await importFreshModelModule('descriptor-privacy-open')
  const result = await call(() => {}, {} as never, '')

  expect(result).toBeTruthy()
  expect(discoverModelsForRoute).not.toHaveBeenCalled()
})

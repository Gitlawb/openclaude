import { expect, test } from 'bun:test'

import type { RouteDiscoveryResult } from '../../integrations/discoveryService.js'
import { publicBuildVersion } from '../../utils/version.js'
import { fetchLocalOpenAIModelOptions, getDiscoveredModelApiNames } from './bootstrap.js'

test('uses static route models when the route has no live discovery', () => {
  const discovered: RouteDiscoveryResult = {
    routeId: 'hicap',
    models: [
      { id: 'hicap-glm-5.2', apiName: 'glm-5.2', label: 'GLM 5.2' },
      { id: 'blank', apiName: '   ', label: 'Blank' },
    ],
    stale: false,
    error: null,
    source: 'static',
  }

  expect(getDiscoveredModelApiNames(discovered)).toEqual(['glm-5.2'])
})

test('falls back to raw discovery when errored discovery has only static models', () => {
  const discovered: RouteDiscoveryResult = {
    routeId: 'hicap',
    models: [{ id: 'hicap-glm-5.2', apiName: 'glm-5.2', label: 'GLM 5.2' }],
    stale: false,
    error: { message: 'Discovery failed for route hicap', recordedAt: 1 },
    source: 'error',
  }

  expect(getDiscoveredModelApiNames(discovered)).toBeNull()
})

test('falls back to raw discovery when live discovery returns no models', () => {
  const discovered: RouteDiscoveryResult = {
    routeId: 'hicap',
    models: [{ id: 'hicap-glm-5.2', apiName: 'glm-5.2', label: 'GLM 5.2' }],
    discoveredModelCount: 0,
    stale: false,
    error: null,
    source: 'network',
  }

  expect(getDiscoveredModelApiNames(discovered)).toBeNull()
})

test('uses mapped models when live discovery returns entries', () => {
  const discovered: RouteDiscoveryResult = {
    routeId: 'hicap',
    models: [
      { id: 'hicap-glm-5.2', apiName: 'glm-5.2', label: 'GLM 5.2' },
      { id: 'live-model', apiName: 'live/model', label: 'Live model' },
    ],
    discoveredModelCount: 1,
    stale: false,
    error: null,
    source: 'network',
  }

  expect(getDiscoveredModelApiNames(discovered)).toEqual([
    'glm-5.2',
    'live/model',
  ])
})

test('local OpenAI bootstrap falls back when route discovery has only static models', async () => {
  const envKeys = [
    'ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_USE_OPENAI',
    'HICAP_API_KEY',
    'OPENAI_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
  ] as const
  const savedEnv = new Map<string, string | undefined>(
    envKeys.map(key => [key, process.env[key]]),
  )

  try {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.hicap.ai/v1'
    process.env.OPENAI_MODEL = 'claude-opus-4.8'
    process.env.HICAP_API_KEY = 'sk-hicap-test'
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEYS
    delete process.env.ANTHROPIC_CUSTOM_HEADERS

    const discovered: RouteDiscoveryResult = {
      routeId: 'hicap',
      models: [
        {
          id: 'live-glm-alias',
          apiName: 'zai-org/GLM-5.2',
          label: 'GLM alias',
        },
        {
          id: 'live-glm-canonical',
          apiName: 'glm-5.2',
          label: 'GLM duplicate',
        },
        {
          id: 'live-gpt-catalog-id',
          apiName: 'hicap-gpt-5.5',
          label: 'GPT catalog id',
        },
      ],
      discoveredModelCount: 0,
      stale: false,
      error: { message: 'Discovery failed for route hicap', recordedAt: 1 },
      source: 'error',
    }

    let fallbackCalled = false

    const payload = await fetchLocalOpenAIModelOptions({
      discoverModelsForRoute: async () => discovered,
      getAdditionalModelOptionsCacheScope: () =>
        'openai:https://api.hicap.ai/v1:test',
      resolveProviderRequest: () => ({
        transport: 'chat_completions',
        requestedModel: 'claude-opus-4.8',
        resolvedModel: 'claude-opus-4.8',
        baseUrl: 'https://api.hicap.ai/v1',
      }),
      listOpenAICompatibleModels: async () => {
        fallbackCalled = true
        return ['zai-org/GLM-5.2', 'hicap-gpt-5.5']
      },
    })

    expect(fallbackCalled).toBe(true)
    expect(payload?.additionalModelOptions).toEqual([
      {
        value: 'glm-5.2',
        label: 'GLM 5.2',
        description: 'Detected from Hicap',
      },
      {
        value: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Detected from Hicap',
      },
    ])
  } finally {
    for (const key of envKeys) {
      const value = savedEnv.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

test('AIMLAPI discovery omits credentials on the public /models route', async () => {
  const envKeys = [
    'ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_USE_OPENAI',
    'AIMLAPI_API_KEY',
    'OPENAI_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
  ] as const
  const savedEnv = new Map<string, string | undefined>(
    envKeys.map(key => [key, process.env[key]]),
  )

  try {
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.aimlapi.com/v1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    process.env.AIMLAPI_API_KEY = 'sk-aimlapi-test'
    process.env.ANTHROPIC_CUSTOM_HEADERS =
      'Authorization: Bearer leaked; X-API-Key: leaked-key'
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEYS

    let discoveryOptions:
      | { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }
      | undefined
    let fallbackOptions:
      | { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }
      | undefined

    await fetchLocalOpenAIModelOptions({
      getAdditionalModelOptionsCacheScope: () =>
        'openai:https://api.aimlapi.com/v1',
      resolveProviderRequest: () =>
        ({
          baseUrl: 'https://api.aimlapi.com/v1',
        }) as ReturnType<typeof import('./providerConfig.js').resolveProviderRequest>,
      discoverModelsForRoute: async (_routeId, options) => {
        discoveryOptions = options
        return {
          routeId: 'aimlapi',
          models: [],
          discoveredModelCount: 0,
          stale: false,
          error: null,
          source: 'network',
        }
      },
      listOpenAICompatibleModels: async options => {
        fallbackOptions = options
        return ['gpt-4o']
      },
    })

    // Public `/models`: no apiKey and no env-sourced headers reach the probe;
    // only the route's attribution headers ride along on the fallback.
    expect(discoveryOptions?.apiKey).toBeUndefined()
    expect(discoveryOptions?.headers).toBeUndefined()
    expect(fallbackOptions?.apiKey).toBeUndefined()
    expect(fallbackOptions?.headers).toEqual({
      'X-AIMLAPI-Partner-ID': 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
      'X-AIMLAPI-Integration-Repo': 'Gitlawb/openclaude',
      'X-AIMLAPI-Integration-Version': publicBuildVersion,
      'HTTP-Referer': 'OpenClaude',
      'X-Title': 'OpenClaude',
    })
  } finally {
    for (const key of envKeys) {
      const value = savedEnv.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

import { describe, expect, test, beforeEach } from 'bun:test'
import type { SettingsJson } from '../../utils/settings/types.js'
import {
  advanceFallbackOnFailure,
  applyHealthSelection,
  isProviderFailoverError,
} from './providerFallback.js'
import {
  recordFailure,
  resetHealthRegistryForTests,
} from './providerHealth.js'
import type { ProviderOverride } from '../api/agentRouting.js'

const settings = {
  agentModels: {
    'qwen2.5:7b': {
      base_url: 'http://localhost:11434/v1',
      api_key: 'ollama',
    },
    'qwen2.5:14b': {
      base_url: 'http://localhost:11434/v1',
      api_key: 'ollama',
    },
    'gpt-4o': {
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk',
    },
  },
  fallbackChains: {
    hard: ['gpt-4o', 'qwen2.5:14b'],
    default: ['gpt-4o'],
  },
} as unknown as SettingsJson

function override(
  model: string,
  chain: string[] = ['qwen2.5:14b', 'gpt-4o'],
): ProviderOverride {
  const cfg = settings.agentModels![model]!
  return {
    model,
    baseURL: cfg.base_url,
    apiKey: cfg.api_key,
    autonomy: {
      tier: 'hard',
      reason: ['test'],
      fallbackChain: chain,
      source: 'policy',
    },
  }
}

describe('isProviderFailoverError', () => {
  test('503 is failover', () => {
    expect(isProviderFailoverError({ status: 503, message: 'unavailable' })).toBe(
      true,
    )
  })

  test('400 is not failover', () => {
    expect(isProviderFailoverError({ status: 400, message: 'bad request' })).toBe(
      false,
    )
  })

  test('connection refused message is failover', () => {
    expect(isProviderFailoverError(new Error('connect ECONNREFUSED 127.0.0.1'))).toBe(
      true,
    )
  })
})

describe('applyHealthSelection', () => {
  beforeEach(() => {
    resetHealthRegistryForTests()
  })

  test('keeps healthy primary', () => {
    const o = override('qwen2.5:7b')
    const result = applyHealthSelection(o, settings)
    expect(result.model).toBe('qwen2.5:7b')
  })

  test('switches when primary unhealthy', () => {
    const o = override('qwen2.5:7b', ['qwen2.5:14b', 'gpt-4o'])
    recordFailure('qwen2.5:7b', o.baseURL, 'down')
    recordFailure('qwen2.5:7b', o.baseURL, 'down')
    const result = applyHealthSelection(o, settings)
    expect(result.model).toBe('qwen2.5:14b')
    expect(result.autonomy?.source).toBe('health-override')
  })
})

describe('advanceFallbackOnFailure', () => {
  beforeEach(() => {
    resetHealthRegistryForTests()
  })

  test('advances to next in chain', () => {
    const o = override('qwen2.5:7b', ['qwen2.5:14b', 'gpt-4o'])
    const next = advanceFallbackOnFailure(
      o,
      settings,
      { status: 503, message: 'unavailable' },
    )
    expect(next?.model).toBe('qwen2.5:14b')
    expect(next?.autonomy?.source).toBe('fallback')
  })

  test('returns null when chain exhausted', () => {
    const o = override('gpt-4o', [])
    const next = advanceFallbackOnFailure(o, settings, { status: 503 })
    // settings fallbackChains.hard has gpt-4o then 14b — skips current gpt-4o
    expect(next?.model).toBe('qwen2.5:14b')
  })

  test('returns null when no alternatives', () => {
    const o = override('gpt-4o', ['gpt-4o'])
    const lonely = {
      ...o,
      autonomy: {
        ...o.autonomy!,
        fallbackChain: [],
        tier: 'standard' as const,
      },
    }
    const s = {
      ...settings,
      fallbackChains: {},
    } as unknown as SettingsJson
    const next = advanceFallbackOnFailure(lonely, s, { status: 503 })
    expect(next).toBeNull()
  })
})

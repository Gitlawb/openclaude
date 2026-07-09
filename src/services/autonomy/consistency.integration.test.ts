/**
 * Consistency evaluation for autonomy stack (Phases 1–4).
 * Asserts policy contracts that a professional agent runtime must hold.
 */
import { describe, expect, test, beforeEach } from 'bun:test'
import type { SettingsJson } from '../../utils/settings/types.js'
import { resolveAgentProvider } from '../api/agentRouting.js'
import { classifyComplexity } from './complexityClassifier.js'
import {
  createCircuitBreakerState,
  defaultCircuitConfig,
  observeToolResult,
} from './circuitBreakers.js'
import {
  advanceFallbackOnFailure,
  applyHealthSelection,
  isProviderFailoverError,
} from './providerFallback.js'
import {
  recordFailure,
  resetHealthRegistryForTests,
} from './providerHealth.js'

const models = {
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
  'qwen3-vl:235b-cloud': {
    base_url: 'http://localhost:11434/v1',
    api_key: 'ollama',
  },
}

function smartSettings(): SettingsJson {
  return {
    autonomy: {
      enabled: true,
      mode: 'smart',
      classifier: 'heuristic',
      circuitBreakers: true,
      telemetry: true,
    },
    agentModels: models,
    agentRouting: {
      Explore: 'qwen3-vl:235b-cloud',
      default: 'gpt-4o',
    },
    taskRouting: {
      trivial: 'qwen2.5:7b',
      standard: 'qwen2.5:14b',
      hard: 'gpt-4o',
      vision: 'qwen3-vl:235b-cloud',
    },
    fallbackChains: {
      hard: ['gpt-4o', 'qwen2.5:14b', 'qwen2.5:7b'],
      default: ['gpt-4o', 'qwen2.5:14b'],
    },
  } as SettingsJson
}

describe('autonomy consistency (professional runtime)', () => {
  beforeEach(() => {
    resetHealthRegistryForTests()
    delete process.env.OPENCLAUDE_AUTONOMY
    delete process.env.OPENCLAUDE_AUTONOMY_MODE
  })

  test('legacy path unchanged when autonomy disabled', () => {
    const settings = {
      ...smartSettings(),
      autonomy: { enabled: false },
    } as SettingsJson
    const r = resolveAgentProvider(undefined, 'Explore', settings, {
      userText: 'olá',
    })
    // Explore still maps to VL, not trivial 7b
    expect(r?.model).toBe('qwen3-vl:235b-cloud')
    expect(r?.autonomy).toBeUndefined()
  })

  test('trivial prompts never select hard model in smart mode', () => {
    const r = resolveAgentProvider(undefined, 'default', smartSettings(), {
      userText: 'oi',
    })
    expect(r?.model).toBe('qwen2.5:7b')
    expect(r?.autonomy?.tier).toBe('trivial')
    expect(r?.effort).toBe('low')
  })

  test('architecture prompts select hard model', () => {
    const r = resolveAgentProvider(undefined, 'default', smartSettings(), {
      userText:
        'Redesenha a arquitetura de autenticação em vários módulos com migration',
    })
    expect(r?.model).toBe('gpt-4o')
    expect(r?.autonomy?.tier).toBe('hard')
    expect(r?.effort).toBe('high')
  })

  test('vision tier beats hard keywords when image present', () => {
    const r = resolveAgentProvider(undefined, 'default', smartSettings(), {
      userText: 'redesenha a arquitetura olhando o screenshot',
      hasImage: true,
    })
    expect(r?.autonomy?.tier).toBe('vision')
    expect(r?.model).toBe('qwen3-vl:235b-cloud')
  })

  test('unhealthy primary is replaced before call', () => {
    const settings = smartSettings()
    const primary = resolveAgentProvider(undefined, 'default', settings, {
      userText: 'oi',
    })!
    expect(primary.model).toBe('qwen2.5:7b')
    recordFailure(primary.model, primary.baseURL, 'down')
    recordFailure(primary.model, primary.baseURL, 'down')
    const again = resolveAgentProvider(undefined, 'default', settings, {
      userText: 'oi',
    })
    // health selection should pick next in fallback of trivial — if empty, may stay
    // trivial fallback comes from taskRouting only; chain from decision.fallbackChains[tier]
    // When 7b unhealthy, applyHealthSelection walks fallbackChain
    expect(again?.model).not.toBe('qwen2.5:7b')
  })

  test('failover error advances chain with provenance', () => {
    const settings = smartSettings()
    const start = resolveAgentProvider(undefined, 'default', settings, {
      userText:
        'Redesenha a arquitetura de autenticação em vários módulos com migration',
    })!
    expect(isProviderFailoverError({ status: 503 })).toBe(true)
    const next = advanceFallbackOnFailure(start, settings, {
      status: 503,
      message: 'unavailable',
    })
    expect(next?.model).toBe('qwen2.5:14b')
    expect(next?.autonomy?.source).toBe('fallback')
    expect(next?.autonomy?.reason.some(r => r.includes('fallback'))).toBe(true)
  })

  test('circuit breaker trips before infinite same-error loop', () => {
    const state = createCircuitBreakerState()
    const cfg = defaultCircuitConfig()
    for (let i = 0; i < 2; i++) {
      expect(
        observeToolResult(
          state,
          { toolName: 'Bash', error: 'command not found' },
          cfg,
        ).tripped,
      ).toBe(false)
    }
    const trip = observeToolResult(
      state,
      { toolName: 'Bash', error: 'command not found' },
      cfg,
    )
    expect(trip.tripped).toBe(true)
  })

  test('classifier is deterministic for fixed prompts', () => {
    const prompts = [
      'olá',
      'Corrige o bug no arquivo src/foo.ts',
      'Redesenha a arquitetura em vários módulos',
    ]
    for (const p of prompts) {
      const a = classifyComplexity({ text: p })
      const b = classifyComplexity({ text: p })
      expect(a.tier).toBe(b.tier)
      expect(a.reasons).toEqual(b.reasons)
    }
  })

  test('quality mode never downgrades below hard mapping when hard configured', () => {
    const settings = {
      ...smartSettings(),
      autonomy: { enabled: true, mode: 'quality' as const },
    } as SettingsJson
    const r = resolveAgentProvider(undefined, 'default', settings, {
      userText: 'oi',
    })
    expect(r?.model).toBe('gpt-4o')
  })

  test('fast mode avoids hard model for hard tier when standard exists', () => {
    const settings = {
      ...smartSettings(),
      autonomy: { enabled: true, mode: 'fast' as const },
    } as SettingsJson
    const r = resolveAgentProvider(undefined, 'default', settings, {
      userText:
        'Redesenha a arquitetura de autenticação em vários módulos com migration',
    })
    expect(r?.model).toBe('qwen2.5:14b')
  })
})

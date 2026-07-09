import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import type { SettingsJson } from '../../utils/settings/types.js'
import {
  isAutonomyEnabled,
  resolveTaskRoute,
  type AutonomyMode,
} from './routePolicy.js'

const models = {
  'qwen2.5:7b': {
    base_url: 'http://localhost:11434/v1',
    api_key: 'ollama',
  },
  'qwen2.5:14b': {
    base_url: 'http://localhost:11434/v1',
    api_key: 'ollama',
  },
  'qwen2.5-coder:7b': {
    base_url: 'http://localhost:11434/v1',
    api_key: 'ollama',
  },
  'gpt-4o': {
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-oai',
  },
  'qwen3-vl:235b-cloud': {
    base_url: 'http://localhost:11434/v1',
    api_key: 'ollama',
  },
}

function settings(partial: Partial<SettingsJson> = {}): SettingsJson {
  return {
    agentModels: models,
    agentRouting: {
      Explore: 'qwen2.5:14b',
      default: 'gpt-4o',
    },
    taskRouting: {
      trivial: 'qwen2.5:7b',
      standard: 'qwen2.5:14b',
      hard: 'gpt-4o',
      vision: 'qwen3-vl:235b-cloud',
    },
    fallbackChains: {
      hard: ['gpt-4o', 'qwen2.5:14b'],
      default: ['gpt-4o'],
    },
    autonomy: {
      enabled: true,
      mode: 'smart',
      classifier: 'heuristic',
    },
    ...partial,
  } as SettingsJson
}

describe('resolveTaskRoute', () => {
  const savedAutonomy = process.env.OPENCLAUDE_AUTONOMY
  const savedMode = process.env.OPENCLAUDE_AUTONOMY_MODE

  beforeEach(() => {
    delete process.env.OPENCLAUDE_AUTONOMY
    delete process.env.OPENCLAUDE_AUTONOMY_MODE
  })

  afterEach(() => {
    if (savedAutonomy === undefined) delete process.env.OPENCLAUDE_AUTONOMY
    else process.env.OPENCLAUDE_AUTONOMY = savedAutonomy
    if (savedMode === undefined) delete process.env.OPENCLAUDE_AUTONOMY_MODE
    else process.env.OPENCLAUDE_AUTONOMY_MODE = savedMode
  })

  test('autonomy disabled → null', () => {
    const result = resolveTaskRoute({
      tier: 'trivial',
      settings: settings({ autonomy: { enabled: false } }),
    })
    expect(result).toBeNull()
  })

  test('mode=fixed → null', () => {
    const result = resolveTaskRoute({
      tier: 'trivial',
      settings: settings({ autonomy: { enabled: true, mode: 'fixed' } }),
    })
    expect(result).toBeNull()
  })

  test('taskRouting.trivial wins for trivial tier', () => {
    const result = resolveTaskRoute({
      tier: 'trivial',
      settings: settings(),
    })
    expect(result?.model).toBe('qwen2.5:7b')
    expect(result?.source).toBe('policy')
    expect(result?.reason.length).toBeGreaterThan(0)
  })

  test('mode=quality forces hard model for trivial', () => {
    const result = resolveTaskRoute({
      tier: 'trivial',
      settings: settings({
        autonomy: { enabled: true, mode: 'quality' as AutonomyMode },
      }),
    })
    expect(result?.model).toBe('gpt-4o')
    expect(result?.reason.some(r => r.includes('quality'))).toBe(true)
  })

  test('mode=fast downgrades hard to standard', () => {
    const result = resolveTaskRoute({
      tier: 'hard',
      settings: settings({
        autonomy: { enabled: true, mode: 'fast' },
      }),
    })
    expect(result?.model).toBe('qwen2.5:14b')
  })

  test('mode=code prefers coder model when available', () => {
    const result = resolveTaskRoute({
      tier: 'standard',
      settings: settings({
        autonomy: { enabled: true, mode: 'code' },
        taskRouting: {
          trivial: 'qwen2.5:7b',
          standard: 'qwen2.5:14b',
          hard: 'gpt-4o',
          vision: 'qwen3-vl:235b-cloud',
        },
      }),
    })
    expect(result?.model).toBe('qwen2.5-coder:7b')
  })

  test('user pin uses static source', () => {
    const result = resolveTaskRoute({
      tier: 'standard',
      settings: settings(),
      userPinnedModel: 'gpt-4o',
    })
    expect(result).toEqual(
      expect.objectContaining({
        model: 'gpt-4o',
        source: 'static',
      }),
    )
  })

  test('fallbackChain excludes primary model', () => {
    const result = resolveTaskRoute({
      tier: 'hard',
      settings: settings(),
    })
    expect(result?.fallbackChain).toEqual(['qwen2.5:14b'])
  })

  test('env OPENCLAUDE_AUTONOMY enables without settings flag', () => {
    process.env.OPENCLAUDE_AUTONOMY = '1'
    expect(
      isAutonomyEnabled(settings({ autonomy: { enabled: false } })),
    ).toBe(true)
  })

  test('legacy agentRouting used when taskRouting missing tier', () => {
    const result = resolveTaskRoute({
      tier: 'standard',
      subagentType: 'Explore',
      settings: settings({
        taskRouting: {
          trivial: 'qwen2.5:7b',
          // no standard
          hard: 'gpt-4o',
          vision: 'qwen3-vl:235b-cloud',
        },
      }),
    })
    expect(result?.model).toBe('qwen2.5:14b')
  })
})

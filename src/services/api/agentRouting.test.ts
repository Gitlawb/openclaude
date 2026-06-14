import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  applyAgentProviderOverrideToEnv,
  isProviderOverride,
  resolveAgentModelProvider,
  resolveAgentProvider,
  resolveAgentRunModelRouting,
  resolveOutOfProcessTeammateProvider,
  resolveOutOfProcessTeammateProviderFromCliArgs,
  shouldEnforceModelAllowlist,
} from './agentRouting.js'
import type { SettingsJson } from '../../utils/settings/types.js'

const baseSettings = {
  agentModels: {
    'deepseek-chat': { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-ds' },
    'gpt-4o': { base_url: 'https://api.openai.com/v1', api_key: 'sk-oai' },
  },
  agentRouting: {
    Explore: 'deepseek-chat',
    'general-purpose': 'gpt-4o',
    'frontend-dev': 'deepseek-chat',
    default: 'gpt-4o',
  },
} as unknown as SettingsJson

describe('resolveAgentProvider', () => {
  let errorSpy: ReturnType<typeof spyOn>
  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  // ── Priority chain ──────────────────────────────────────────

  test('name takes priority over subagentType', () => {
    const result = resolveAgentProvider('frontend-dev', 'Explore', baseSettings)
    expect(result).toEqual({
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds',
    })
  })

  test('subagentType used when name has no match', () => {
    const result = resolveAgentProvider('unknown-name', 'Explore', baseSettings)
    expect(result).toEqual({
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds',
    })
  })

  test('falls back to "default" when neither name nor subagentType match', () => {
    const result = resolveAgentProvider('nobody', 'unknown-type', baseSettings)
    expect(result).toEqual({
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-oai',
    })
  })

  test('returns null when no routing match and no default', () => {
    const settings = {
      agentModels: baseSettings.agentModels,
      agentRouting: { Explore: 'deepseek-chat' },
    } as unknown as SettingsJson
    const result = resolveAgentProvider('nobody', 'unknown-type', settings)
    expect(result).toBeNull()
  })

  test('returns null when name and subagentType are both undefined', () => {
    const settings = {
      agentModels: baseSettings.agentModels,
      agentRouting: { Explore: 'deepseek-chat' },
    } as unknown as SettingsJson
    const result = resolveAgentProvider(undefined, undefined, settings)
    expect(result).toBeNull()
  })

  // ── normalize() matching ────────────────────────────────────

  test('matching is case-insensitive', () => {
    const result = resolveAgentProvider(undefined, 'explore', baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('matching is case-insensitive (UPPER)', () => {
    const result = resolveAgentProvider(undefined, 'EXPLORE', baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('hyphen and underscore are equivalent', () => {
    const result = resolveAgentProvider(undefined, 'general_purpose', baseSettings)
    expect(result?.model).toBe('gpt-4o')
  })

  test('underscore in config matches hyphen in input', () => {
    const settings = {
      agentModels: baseSettings.agentModels,
      agentRouting: { general_purpose: 'deepseek-chat' },
    } as unknown as SettingsJson
    const result = resolveAgentProvider(undefined, 'general-purpose', settings)
    expect(result?.model).toBe('deepseek-chat')
  })

  // ── Edge cases ──────────────────────────────────────────────

  test('returns null when settings is null', () => {
    expect(resolveAgentProvider('Explore', 'Explore', null)).toBeNull()
  })

  test('returns null when agentRouting is missing', () => {
    const settings = { agentModels: baseSettings.agentModels } as unknown as SettingsJson
    expect(resolveAgentProvider(undefined, 'Explore', settings)).toBeNull()
  })

  test('returns null when agentModels is missing', () => {
    const settings = { agentRouting: baseSettings.agentRouting } as unknown as SettingsJson
    expect(resolveAgentProvider(undefined, 'Explore', settings)).toBeNull()
  })

  test('returns null when routing references non-existent model', () => {
    const settings = {
      agentModels: {},
      agentRouting: { Explore: 'non-existent-model' },
    } as unknown as SettingsJson
    expect(resolveAgentProvider(undefined, 'Explore', settings)).toBeNull()
  })

  test('subagentType only (no name)', () => {
    const result = resolveAgentProvider(undefined, 'Explore', baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('name only (no subagentType)', () => {
    const result = resolveAgentProvider('frontend-dev', undefined, baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('configured model key can alias a different API model name', () => {
    const settings = {
      agentModels: {
        zai: {
          model: 'glm-5.1',
          base_url: 'https://api.z.ai/api/coding/paas/v4',
          api_key: 'sk-zai',
        },
      },
      agentRouting: { default: 'zai' },
    } as unknown as SettingsJson

    const result = resolveAgentProvider(undefined, undefined, settings)

    expect(result).toEqual({
      model: 'glm-5.1',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      apiKey: 'sk-zai',
    })
  })

  test('blank API keys do not create provider overrides', () => {
    const settings = {
      agentModels: {
        zai: {
          model: 'glm-5.1',
          base_url: 'https://api.z.ai/api/coding/paas/v4',
          api_key: '',
        },
      },
      agentRouting: { default: 'zai' },
    } as unknown as SettingsJson

    expect(resolveAgentProvider(undefined, undefined, settings)).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      '[agentRouting] Warning: agentModels entry "zai" has only one of base_url/api_key; both are required for cross-provider routing. Skipping this route.',
    )
  })

})

const modelOnlySettings = {
  agentModels: {
    mini: { model: 'gpt-5-mini' },
    bare: {},
    'half-entry': { base_url: 'https://api.example.com/v1' }, // missing api_key
  },
  agentRouting: {
    verification: 'mini',
    Explore: 'bare',
    Plan: 'half-entry',
  },
} as unknown as SettingsJson

describe('model-only routes', () => {
  let errorSpy: ReturnType<typeof spyOn>
  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  test('resolveAgentProvider returns a model-only route (no credentials)', () => {
    const route = resolveAgentProvider(undefined, 'verification', modelOnlySettings)
    expect(route).toEqual({ model: 'gpt-5-mini' })
    expect(isProviderOverride(route!)).toBe(false)
  })

  test('bare entry defaults the model to the route key', () => {
    const route = resolveAgentProvider(undefined, 'Explore', modelOnlySettings)
    expect(route).toEqual({ model: 'bare' })
  })

  test('partial entry (only base_url) is skipped', () => {
    const route = resolveAgentProvider(undefined, 'Plan', modelOnlySettings)
    expect(route).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      '[agentRouting] Warning: agentModels entry "half-entry" has only one of base_url/api_key; both are required for cross-provider routing. Skipping this route.',
    )
  })

  test('resolveAgentRunModelRouting: model-only sets mainLoopModel, no providerOverride', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'parent-model',
      subagentType: 'verification',
      settings: modelOnlySettings,
    })
    expect(result).toEqual({ mainLoopModel: 'gpt-5-mini' })
    expect('providerOverride' in result).toBe(false)
  })

  test('resolveAgentRunModelRouting: no route falls back to resolvedAgentModel', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'parent-model',
      subagentType: 'unconfigured',
      settings: modelOnlySettings,
    })
    expect(result).toEqual({ mainLoopModel: 'parent-model' })
  })
})

describe('resolveAgentModelProvider', () => {
  test('returns null when settings is null', () => {
    expect(resolveAgentModelProvider('deepseek-chat', null)).toBeNull()
  })

  test('returns null when agentModels is missing', () => {
    const settings = { agentRouting: baseSettings.agentRouting } as unknown as SettingsJson
    expect(resolveAgentModelProvider('deepseek-chat', settings)).toBeNull()
  })

  test('exact match returns provider override', () => {
    const result = resolveAgentModelProvider('deepseek-chat', baseSettings)
    expect(result).toEqual({
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds',
    })
  })

  test('trims whitespace around requested model', () => {
    const result = resolveAgentModelProvider('  deepseek-chat  ', baseSettings)
    expect(result?.model).toBe('deepseek-chat')
  })

  test('exact match can resolve to a different API model name', () => {
    const settings = {
      agentModels: {
        zai: {
          model: 'glm-5.1',
          base_url: 'https://api.z.ai/api/coding/paas/v4',
          api_key: 'sk-zai',
        },
      },
    } as unknown as SettingsJson

    expect(resolveAgentModelProvider('zai', settings)).toEqual({
      model: 'glm-5.1',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      apiKey: 'sk-zai',
    })
  })

  test('no fuzzy matching', () => {
    expect(resolveAgentModelProvider('deepseek_chat', baseSettings)).toBeNull()
    expect(resolveAgentModelProvider('DEEPSEEK-CHAT', baseSettings)).toBeNull()
  })
})

describe('resolveAgentRunModelRouting', () => {
  let errorSpy: ReturnType<typeof spyOn>
  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  test('explicit configured model wins over agentRouting', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'parent-model',
      toolSpecifiedModel: 'deepseek-chat',
      agentName: 'frontend-dev',
      subagentType: 'Explore',
      settings: baseSettings,
    })

    expect(result).toEqual({
      mainLoopModel: 'deepseek-chat',
      providerOverride: {
        model: 'deepseek-chat',
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: 'sk-ds',
      },
    })
  })

  test('explicit non-configured model keeps resolved model behavior', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'haiku-model',
      toolSpecifiedModel: 'haiku',
      agentName: 'frontend-dev',
      subagentType: 'Explore',
      settings: baseSettings,
    })

    expect(result).toEqual({ mainLoopModel: 'haiku-model' })
  })

  test('explicit inherit keeps resolved parent model despite default routing', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'parent-runtime-model',
      toolSpecifiedModel: ' InHerit ',
      subagentType: 'unknown-type',
      settings: baseSettings,
    })

    expect(result).toEqual({ mainLoopModel: 'parent-runtime-model' })
  })

  test('agent definition model key is used after routing misses', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'default-model',
      subagentType: 'unknown-type',
      agentDefinitionModel: 'deepseek-chat',
      settings: {
        agentModels: baseSettings.agentModels,
        agentRouting: {},
      } as unknown as SettingsJson,
    })

    expect(result.mainLoopModel).toBe('deepseek-chat')
    expect(result.providerOverride?.apiKey).toBe('sk-ds')
  })

  test('falls back to resolved model when no provider override matches', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'default-model',
      toolSpecifiedModel: 'haiku',
      subagentType: 'unknown-type',
      agentDefinitionModel: 'sonnet',
      settings: {
        agentModels: baseSettings.agentModels,
        agentRouting: {},
      } as unknown as SettingsJson,
    })

    expect(result).toEqual({ mainLoopModel: 'default-model' })
  })

  test('falls back to resolved model when routed provider has a blank API key', () => {
    const result = resolveAgentRunModelRouting({
      resolvedAgentModel: 'parent-runtime-model',
      subagentType: 'Explore',
      settings: {
        agentModels: {
          zai: {
            model: 'glm-5.1',
            base_url: 'https://api.z.ai/api/coding/paas/v4',
            api_key: '   ',
          },
        },
        agentRouting: { Explore: 'zai' },
      } as unknown as SettingsJson,
    })

    expect(result).toEqual({ mainLoopModel: 'parent-runtime-model' })
    expect(errorSpy).toHaveBeenCalledWith(
      '[agentRouting] Warning: agentModels entry "zai" has only one of base_url/api_key; both are required for cross-provider routing. Skipping this route.',
    )
  })
})

describe('resolveOutOfProcessTeammateProvider', () => {
  test('explicit configured teammate model wins over routing', () => {
    const result = resolveOutOfProcessTeammateProvider({
      cliModel: 'deepseek-chat',
      agentName: 'frontend-dev',
      agentType: 'general-purpose',
      settings: baseSettings,
    })

    expect(result).toEqual({
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds',
    })
  })

  test('explicit non-configured teammate model does not fall through to routing', () => {
    const result = resolveOutOfProcessTeammateProvider({
      cliModel: 'custom-model-id',
      agentName: 'frontend-dev',
      agentType: 'Explore',
      settings: baseSettings,
    })

    expect(result).toBeNull()
  })

  test('uses teammate name, agent type, then default routing when no model flag was provided', () => {
    expect(
      resolveOutOfProcessTeammateProvider({
        agentName: 'frontend-dev',
        agentType: 'general-purpose',
        settings: baseSettings,
      })?.model,
    ).toBe('deepseek-chat')

    expect(
      resolveOutOfProcessTeammateProvider({
        agentName: 'unknown-name',
        agentType: 'general-purpose',
        settings: baseSettings,
      })?.model,
    ).toBe('gpt-4o')

    expect(
      resolveOutOfProcessTeammateProvider({
        agentName: 'unknown-name',
        agentType: 'unknown-type',
        settings: baseSettings,
      })?.model,
    ).toBe('gpt-4o')
  })

  test('falls back to agent definition model key after routing misses', () => {
    const result = resolveOutOfProcessTeammateProvider({
      agentName: 'unknown-name',
      agentType: 'unknown-type',
      agentDefinitionModel: 'deepseek-chat',
      settings: {
        agentModels: baseSettings.agentModels,
        agentRouting: {},
      } as unknown as SettingsJson,
    })

    expect(result?.model).toBe('deepseek-chat')
  })
})

describe('resolveOutOfProcessTeammateProviderFromCliArgs', () => {
  test('routes split-pane teammate args with a configured model flag', () => {
    const result = resolveOutOfProcessTeammateProviderFromCliArgs(
      [
        '--agent-name',
        'worker-a',
        '--team-name',
        'review-team',
        '--model',
        'deepseek-chat',
      ],
      baseSettings,
    )

    expect(result?.model).toBe('deepseek-chat')
    expect(result?.baseURL).toBe('https://api.deepseek.com/v1')
  })

  test('supports equals-form CLI flags and agent type routing', () => {
    const result = resolveOutOfProcessTeammateProviderFromCliArgs(
      [
        '--agent-name=worker-a',
        '--team-name=review-team',
        '--agent-type=general-purpose',
      ],
      baseSettings,
    )

    expect(result?.model).toBe('gpt-4o')
  })

  test('does not route non-teammate CLI processes', () => {
    expect(
      resolveOutOfProcessTeammateProviderFromCliArgs(
        ['--model', 'deepseek-chat'],
        baseSettings,
      ),
    ).toBeNull()
    expect(
      resolveOutOfProcessTeammateProviderFromCliArgs(
        ['--agent-name', 'worker-a', '--model', 'deepseek-chat'],
        baseSettings,
      ),
    ).toBeNull()
  })

  test('does not override explicit provider selection in either CLI flag form', () => {
    expect(
      resolveOutOfProcessTeammateProviderFromCliArgs(
        [
          '--provider',
          'openai',
          '--agent-name',
          'worker-a',
          '--team-name',
          'review-team',
          '--model',
          'deepseek-chat',
        ],
        baseSettings,
      ),
    ).toBeNull()

    expect(
      resolveOutOfProcessTeammateProviderFromCliArgs(
        [
          '--provider=openai',
          '--agent-name=worker-a',
          '--team-name=review-team',
          '--model=deepseek-chat',
        ],
        baseSettings,
      ),
    ).toBeNull()
  })
})

describe('applyAgentProviderOverrideToEnv', () => {
  test('switches a spawned teammate process to OpenAI-compatible routing', () => {
    const env: Record<string, string | undefined> = {
      CLAUDE_CODE_USE_GEMINI: '1',
      CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: '1',
      CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID: 'saved-gemini',
      GEMINI_MODEL: 'gemini-parent',
      GEMINI_API_KEY: 'gemini-key',
      ANTHROPIC_MODEL: 'claude-parent',
      ANTHROPIC_API_KEY: 'anthropic-key',
      OPENAI_API_BASE: 'https://old.example/v1',
      OPENAI_AUTH_HEADER: 'X-Old-Key',
    }

    applyAgentProviderOverrideToEnv(
      {
        model: 'deepseek-chat',
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: 'sk-ds',
      },
      env,
    )

    expect(env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(env.OPENAI_MODEL).toBe('deepseek-chat')
    expect(env.OPENAI_BASE_URL).toBe('https://api.deepseek.com/v1')
    expect(env.OPENAI_API_KEY).toBe('sk-ds')
    expect(env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED).toBeUndefined()
    expect(env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBeUndefined()
    expect(env.GEMINI_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
    expect(env.OPENAI_API_BASE).toBeUndefined()
    expect(env.OPENAI_AUTH_HEADER).toBeUndefined()
    expect(env.GEMINI_API_KEY).toBe('gemini-key')
    expect(env.ANTHROPIC_API_KEY).toBe('anthropic-key')
  })
})

describe('shouldEnforceModelAllowlist', () => {
  test('enforces when a provider override is present', () => {
    expect(shouldEnforceModelAllowlist('m', 'm', true)).toBe(true)
  })
  test('enforces when a model-only route changed the effective model', () => {
    expect(shouldEnforceModelAllowlist('parent', 'gpt-5-mini', false)).toBe(true)
  })
  test('does not enforce when the model is unchanged and no override', () => {
    expect(shouldEnforceModelAllowlist('m', 'm', false)).toBe(false)
  })
})

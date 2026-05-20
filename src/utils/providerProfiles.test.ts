import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { ProviderProfile } from './config.js'

async function importFreshProvidersModule() {
  return import(`./model/providers.ts?ts=${Date.now()}-${Math.random()}`)
}

const originalEnv = { ...process.env }

const RESTORED_KEYS = [
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
] as const

type MockConfigState = {
  providerProfiles: ProviderProfile[]
  activeProviderProfileId?: string
  openaiAdditionalModelOptionsCache: unknown[]
  openaiAdditionalModelOptionsCacheByProfile: Record<string, unknown[]>
  additionalModelOptionsCache?: unknown[]
  additionalModelOptionsCacheScope?: string
}

function createMockConfigState(): MockConfigState {
  return {
    providerProfiles: [],
    activeProviderProfileId: undefined,
    openaiAdditionalModelOptionsCache: [],
    openaiAdditionalModelOptionsCacheByProfile: {},
    additionalModelOptionsCache: [],
    additionalModelOptionsCacheScope: undefined,
  }
}

let mockConfigState: MockConfigState = createMockConfigState()
let mockPersistedProfile:
  | {
      profile: string
      env: Record<string, unknown>
      createdAt: string
    }
  | null = null
let mockDeletedProfile = false

function saveMockGlobalConfig(
  updater: (current: MockConfigState) => MockConfigState,
): void {
  mockConfigState = updater(mockConfigState)
}

afterEach(() => {
  for (const key of RESTORED_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }

  mock.restore()
  mockConfigState = createMockConfigState()
  mockPersistedProfile = null
  mockDeletedProfile = false
})

async function importFreshProviderProfileModules() {
  mock.restore()
  mock.module('./config.js', () => ({
    checkHasTrustDialogAccepted: () => true,
    getGlobalConfig: () => mockConfigState,
    saveGlobalConfig: (
      updater: (current: MockConfigState) => MockConfigState,
    ) => {
      mockConfigState = updater(mockConfigState)
    },
  }))
  mock.module('./providerProfile.js', () => ({
    createProfileFile: (profile: string, env: Record<string, unknown>) => ({
      profile,
      env,
      createdAt: '2026-04-16T00:00:00.000Z',
    }),
    saveProfileFile: (profileFile: {
      profile: string
      env: Record<string, unknown>
      createdAt: string
    }) => {
      mockPersistedProfile = profileFile
      mockDeletedProfile = false
      return '.openclaude-profile.json'
    },
    deleteProfileFile: () => {
      mockPersistedProfile = null
      mockDeletedProfile = true
      return '.openclaude-profile.json'
    },
    loadProfileFile: () => mockPersistedProfile,
    isCodexBaseUrl: (value: string) => value.includes('chatgpt.com/backend-api/codex'),
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  const providers = await import(`./model/providers.js?ts=${nonce}`)
  const providerProfiles = await import(`./providerProfiles.js?ts=${nonce}`)

  return {
    ...providers,
    ...providerProfiles,
  }
}

function buildProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider_test',
    name: 'Test Provider',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    ...overrides,
  }
}

describe('applyProviderProfileToProcessEnv', () => {
  test('openai profile clears competing gemini/github flags', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.CLAUDE_CODE_USE_GITHUB = '1'

    applyProviderProfileToProcessEnv(buildProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBeUndefined()
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
      'provider_test',
    )
    expect(getFreshAPIProvider()).toBe('openai')
  })

  test('anthropic profile clears competing gemini/github flags', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.CLAUDE_CODE_USE_GITHUB = '1'

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
      }),
    )
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(getFreshAPIProvider()).toBe('firstParty')
  })
})

describe('applyActiveProviderProfileFromConfig', () => {
  test('does not override explicit startup provider selection', async () => {
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_MODEL = 'qwen2.5:3b'

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        }),
      ],
      activeProviderProfileId: 'saved_openai',
    } as any)

    expect(applied).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1')
    expect(process.env.OPENAI_MODEL).toBe('qwen2.5:3b')
  })

  test('does not override explicit startup selection when profile marker is stale', async () => {
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_MODEL = 'qwen2.5:3b'

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        }),
      ],
      activeProviderProfileId: 'saved_openai',
    } as any)

    expect(applied).toBeUndefined()
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1')
    expect(process.env.OPENAI_MODEL).toBe('qwen2.5:3b')
  })

  test('re-applies active profile when profile-managed env drifts', async () => {
    const { applyActiveProviderProfileFromConfig, applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    applyProviderProfileToProcessEnv(
      buildProfile({
        id: 'saved_openai',
        baseUrl: 'http://192.168.33.108:11434/v1',
        model: 'kimi-k2.5:cloud',
      }),
    )

    // Simulate settings/env merge clobbering the model while profile flags remain.
    process.env.OPENAI_MODEL = 'github:copilot'

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_openai',
          baseUrl: 'http://192.168.33.108:11434/v1',
          model: 'kimi-k2.5:cloud',
        }),
      ],
      activeProviderProfileId: 'saved_openai',
    } as any)

    expect(applied?.id).toBe('saved_openai')
    expect(process.env.OPENAI_MODEL).toBe('kimi-k2.5:cloud')
    expect(process.env.OPENAI_BASE_URL).toBe('http://192.168.33.108:11434/v1')
  })

  test('does not re-apply active profile when flags conflict with current provider', async () => {
    const { applyActiveProviderProfileFromConfig, applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    applyProviderProfileToProcessEnv(
      buildProfile({
        id: 'saved_openai',
        baseUrl: 'http://192.168.33.108:11434/v1',
        model: 'kimi-k2.5:cloud',
      }),
    )

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_MODEL = 'github:copilot'

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_openai',
          baseUrl: 'http://192.168.33.108:11434/v1',
          model: 'kimi-k2.5:cloud',
        }),
      ],
      activeProviderProfileId: 'saved_openai',
    } as any)

    expect(applied).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(process.env.OPENAI_MODEL).toBe('github:copilot')
  })

  test('applies active profile when no explicit provider is selected', async () => {
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID

    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_MODEL = 'qwen2.5:3b'

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        }),
      ],
      activeProviderProfileId: 'saved_openai',
    } as any)

    expect(applied?.id).toBe('saved_openai')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
  })
})

describe('persistActiveProviderProfileModel', () => {
  test('updates active profile model and current env for profile-managed sessions', async () => {
    const {
      applyProviderProfileToProcessEnv,
      getProviderProfiles,
      persistActiveProviderProfileModel,
    } = await importFreshProviderProfileModules()
    const activeProfile = buildProfile({
      id: 'saved_openai',
      baseUrl: 'http://192.168.33.108:11434/v1',
      model: 'kimi-k2.5:cloud',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [activeProfile],
      activeProviderProfileId: activeProfile.id,
    }))
    applyProviderProfileToProcessEnv(activeProfile)

    const updated = persistActiveProviderProfileModel('minimax-m2.5:cloud')

    expect(updated?.id).toBe(activeProfile.id)
    expect(updated?.model).toBe('minimax-m2.5:cloud')
    expect(process.env.OPENAI_MODEL).toBe('minimax-m2.5:cloud')
    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
      activeProfile.id,
    )

    const saved = getProviderProfiles().find(
      (profile: ProviderProfile) => profile.id === activeProfile.id,
    )
    expect(saved?.model).toBe('minimax-m2.5:cloud')
  })

  test('does not mutate process env when session is not profile-managed', async () => {
    const {
      getProviderProfiles,
      persistActiveProviderProfileModel,
    } = await importFreshProviderProfileModules()
    const activeProfile = buildProfile({
      id: 'saved_openai',
      model: 'kimi-k2.5:cloud',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [activeProfile],
      activeProviderProfileId: activeProfile.id,
    }))

    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'cli-model'
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID

    persistActiveProviderProfileModel('minimax-m2.5:cloud')

    expect(process.env.OPENAI_MODEL).toBe('cli-model')
    const saved = getProviderProfiles().find(
      (profile: ProviderProfile) => profile.id === activeProfile.id,
    )
    expect(saved?.model).toBe('minimax-m2.5:cloud')
  })
})

describe('startup profile sync', () => {
  test('saving an active openai-compatible profile persists startup settings', async () => {
    const { addProviderProfile } = await importFreshProviderProfileModules()

    const saved = addProviderProfile({
      provider: 'openai',
      name: 'OnlySQ',
      baseUrl: 'https://api.onlysq.ru/ai/openai',
      model: 'gemini-3-flash',
      apiKey: 'sq-test',
    })

    expect(saved?.name).toBe('OnlySQ')
    expect(mockPersistedProfile?.profile).toBe('openai')
    expect(mockPersistedProfile?.env).toEqual({
      OPENAI_BASE_URL: 'https://api.onlysq.ru/ai/openai',
      OPENAI_MODEL: 'gemini-3-flash',
      OPENAI_API_KEY: 'sq-test',
    })
    expect(mockDeletedProfile).toBe(false)
  })

  test('activating an anthropic profile persists anthropic startup settings', async () => {
    const { setActiveProviderProfile } = await importFreshProviderProfileModules()
    const anthropicProfile = buildProfile({
      id: 'anthropic_profile',
      provider: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-test',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [anthropicProfile],
      activeProviderProfileId: anthropicProfile.id,
    }))

    const active = setActiveProviderProfile(anthropicProfile.id)

    expect(active?.id).toBe(anthropicProfile.id)
    expect(mockPersistedProfile?.profile).toBe('anthropic')
    expect(mockPersistedProfile?.env).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    })
  })

  test('deleting the last active profile clears the persisted startup profile', async () => {
    const { deleteProviderProfile } = await importFreshProviderProfileModules()
    mockPersistedProfile = {
      profile: 'openai',
      env: {
        OPENAI_BASE_URL: 'https://api.onlysq.ru/ai/openai',
        OPENAI_MODEL: 'gemini-3-flash',
      },
      createdAt: '2026-04-16T00:00:00.000Z',
    }

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [buildProfile({ id: 'only_profile' })],
      activeProviderProfileId: 'only_profile',
    }))

    const result = deleteProviderProfile('only_profile')

    expect(result.removed).toBe(true)
    expect(mockPersistedProfile).toBeNull()
    expect(mockDeletedProfile).toBe(true)
  })
})

describe('getProviderPresetDefaults', () => {
  test('ollama preset defaults to a local Ollama model', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    delete process.env.OPENAI_MODEL

    const defaults = getProviderPresetDefaults('ollama')

    expect(defaults.baseUrl).toBe('http://localhost:11434/v1')
    expect(defaults.model).toBe('llama3.1:8b')
  })

  test('onlysq preset uses the provider route without /v1', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('onlysq')

    expect(defaults.provider).toBe('openai')
    expect(defaults.baseUrl).toBe('https://api.onlysq.ru/ai/openai')
    expect(defaults.model).toBe('gemini-3-flash')
    expect(defaults.requiresApiKey).toBe(true)
  })
})

describe('deleteProviderProfile', () => {
  test('deleting final profile clears provider env when active profile applied it', async () => {
    const {
      applyProviderProfileToProcessEnv,
      deleteProviderProfile,
    } = await importFreshProviderProfileModules()
    applyProviderProfileToProcessEnv(
      buildProfile({
        id: 'only_profile',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      }),
    )

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [buildProfile({ id: 'only_profile' })],
      activeProviderProfileId: 'only_profile',
    }))

    const result = deleteProviderProfile('only_profile')

    expect(result.removed).toBe(true)
    expect(result.activeProfileId).toBeUndefined()

    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED).toBeUndefined()

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_VERTEX).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined()

    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_API_BASE).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()

    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(process.env.ANTHROPIC_MODEL).toBeUndefined()
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('deleting final profile preserves explicit startup provider env', async () => {
    const { deleteProviderProfile } = await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_MODEL = 'qwen2.5:3b'

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [buildProfile({ id: 'only_profile' })],
      activeProviderProfileId: 'only_profile',
    }))

    const result = deleteProviderProfile('only_profile')

    expect(result.removed).toBe(true)
    expect(result.activeProfileId).toBeUndefined()

    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED).toBeUndefined()
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1')
    expect(process.env.OPENAI_MODEL).toBe('qwen2.5:3b')
  })
})

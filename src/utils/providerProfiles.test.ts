import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { ProviderProfile } from './config.js'

async function importFreshProvidersModule() {
  return import(`./model/providers.ts?ts=${Date.now()}-${Math.random()}`)
}

const originalEnv = { ...process.env }

const RESTORED_KEYS = [
  'CLAUDE_CODE_EXPLICIT_PROVIDER',
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
})

async function importFreshProviderProfileModules() {
  mock.restore()
  mock.module('./config.js', () => ({
    getGlobalConfig: () => mockConfigState,
    saveGlobalConfig: (
      updater: (current: MockConfigState) => MockConfigState,
    ) => {
      mockConfigState = updater(mockConfigState)
    },
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
  test('does not override explicit anthropic startup selection', async () => {
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_EXPLICIT_PROVIDER = 'anthropic'

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_github',
          baseUrl: 'https://api.githubcopilot.com',
          model: 'github:copilot',
        }),
      ],
      activeProviderProfileId: 'saved_github',
    } as any)

    expect(applied).toBeUndefined()
    expect(process.env.CLAUDE_CODE_EXPLICIT_PROVIDER).toBe('anthropic')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
  })

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

describe('getProviderPresetDefaults', () => {
  test('ollama preset defaults to a local Ollama model', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    delete process.env.OPENAI_MODEL

    const defaults = getProviderPresetDefaults('ollama')

    expect(defaults.baseUrl).toBe('http://localhost:11434/v1')
    expect(defaults.model).toBe('llama3.1:8b')
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

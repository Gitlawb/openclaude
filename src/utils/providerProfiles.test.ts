import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { ProviderProfile } from './config.js'

async function importFreshProvidersModule() {
  return import(`./model/providers.ts?ts=${Date.now()}-${Math.random()}`)
}

const originalEnv = { ...process.env }
const originalCwd = process.cwd()

const RESTORED_KEYS = [
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
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
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_AUTH_MODE',
  'GEMINI_ACCESS_TOKEN',
  'GOOGLE_API_KEY',
  'MISTRAL_BASE_URL',
  'MISTRAL_MODEL',
  'MISTRAL_API_KEY',
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
  process.chdir(originalCwd)
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

function buildMistralProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return buildProfile({
    provider: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'devstral-latest',
    ...overrides,
  })
}

function buildGeminiProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return buildProfile({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3-flash-preview',
    ...overrides,
  })
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

  test('mistral profile sets CLAUDE_CODE_USE_MISTRAL and clears openai flags', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    applyProviderProfileToProcessEnv(buildMistralProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_MISTRAL).toBe('1')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.MISTRAL_MODEL).toBe('devstral-latest')
    expect(getFreshAPIProvider()).toBe('mistral')
  })

  test('gemini profile sets CLAUDE_CODE_USE_GEMINI and clears openai flags', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    applyProviderProfileToProcessEnv(buildGeminiProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBe('1')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.GEMINI_MODEL).toBe('gemini-3-flash-preview')
    expect(getFreshAPIProvider()).toBe('gemini')
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

  test('openai profile with multi-model string sets only first model in OPENAI_MODEL', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'glm-4.7, glm-4.7-flash, glm-4.7-plus',
      }),
    )

    expect(process.env.OPENAI_MODEL).toBe('glm-4.7')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
  })

  test('openai profile with semicolon-separated multi-model string sets only first model in OPENAI_MODEL', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'glm-4.7; glm-4.7-flash; glm-4.7-plus',
      }),
    )

    expect(process.env.OPENAI_MODEL).toBe('glm-4.7')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
  })

  test('anthropic profile with multi-model string sets only first model in ANTHROPIC_MODEL', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6, claude-opus-4-6',
      }),
    )

    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
  })

  test('gemini profile with semicolon-separated multi-model string sets only first model in GEMINI_MODEL', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildGeminiProfile({
        model: 'gemini-3-flash-preview; gemini-3-pro-preview',
      }),
    )

    expect(process.env.GEMINI_MODEL).toBe('gemini-3-flash-preview')
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBe('1')
  })

  test('mistral profile with semicolon-separated multi-model string sets only first model in MISTRAL_MODEL', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildMistralProfile({
        model: 'devstral-latest; mistral-medium-latest',
      }),
    )

    expect(process.env.MISTRAL_MODEL).toBe('devstral-latest')
    expect(process.env.CLAUDE_CODE_USE_MISTRAL).toBe('1')
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

  test('applies active profile when a bare CLAUDE_CODE_USE_OPENAI flag is stale (no BASE_URL/MODEL)', async () => {
    // Regression: a leftover `CLAUDE_CODE_USE_OPENAI=1` in the shell with no
    // paired OPENAI_BASE_URL / OPENAI_MODEL is not a real explicit selection
    // — it's a stale export. The previous guard treated it as intent and
    // skipped the saved profile, causing the startup banner to show hardcoded
    // defaults (gpt-4o @ api.openai.com) instead of the user's active
    // profile.
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.OPENAI_MODEL

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_moonshot',
          baseUrl: 'https://api.moonshot.ai/v1',
          model: 'kimi-k2.6',
        }),
      ],
      activeProviderProfileId: 'saved_moonshot',
    } as any)

    expect(applied?.id).toBe('saved_moonshot')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.moonshot.ai/v1')
    expect(process.env.OPENAI_MODEL).toBe('kimi-k2.6')
  })

  test('still respects complete shell selection with USE flag + BASE_URL', async () => {
    // Counter-example: when the user really did set both the flag AND a
    // concrete BASE_URL, that IS explicit intent and wins over the saved
    // profile. This preserves the original "explicit startup wins" semantic.
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://192.168.1.1:8080/v1'
    delete process.env.OPENAI_MODEL

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_moonshot',
          baseUrl: 'https://api.moonshot.ai/v1',
          model: 'kimi-k2.6',
        }),
      ],
      activeProviderProfileId: 'saved_moonshot',
    } as any)

    expect(applied).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe('http://192.168.1.1:8080/v1')
  })

  test('still respects complete shell selection with USE flag + MODEL', async () => {
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4o-mini'
    delete process.env.OPENAI_BASE_URL

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [
        buildProfile({
          id: 'saved_moonshot',
          baseUrl: 'https://api.moonshot.ai/v1',
          model: 'kimi-k2.6',
        }),
      ],
      activeProviderProfileId: 'saved_moonshot',
    } as any)

    expect(applied).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o-mini')
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

describe('getProviderPresetDefaults', () => {
  test('ollama preset defaults to a local Ollama model', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    delete process.env.OPENAI_MODEL

    const defaults = getProviderPresetDefaults('ollama')

    expect(defaults.baseUrl).toBe('http://localhost:11434/v1')
    expect(defaults.model).toBe('llama3.1:8b')
  })

  test('atomic-chat preset defaults to a local Atomic Chat endpoint', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    delete process.env.OPENAI_MODEL

    const defaults = getProviderPresetDefaults('atomic-chat')

    expect(defaults.provider).toBe('openai')
    expect(defaults.name).toBe('Atomic Chat')
    expect(defaults.baseUrl).toBe('http://127.0.0.1:1337/v1')
    expect(defaults.requiresApiKey).toBe(false)
  })

  test('kimi-code preset defaults to the Kimi Code coding endpoint', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('kimi-code')

    expect(defaults.provider).toBe('openai')
    expect(defaults.name).toBe('Moonshot AI - Kimi Code')
    expect(defaults.baseUrl).toBe('https://api.kimi.com/coding/v1')
    expect(defaults.model).toBe('kimi-for-coding')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('moonshotai preset keeps the direct API under the renamed display label', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('moonshotai')

    expect(defaults.name).toBe('Moonshot AI - API')
    expect(defaults.baseUrl).toBe('https://api.moonshot.ai/v1')
    expect(defaults.model).toBe('kimi-k2.5')
  })
  test('deepseek preset defaults to DeepSeek V4 flash and exposes flash/pro aliases', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('deepseek')

    expect(defaults.provider).toBe('openai')
    expect(defaults.name).toBe('DeepSeek')
    expect(defaults.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(defaults.model).toBe(
      'deepseek-v4-flash, deepseek-v4-pro, deepseek-chat, deepseek-reasoner',
    )
    expect(defaults.requiresApiKey).toBe(true)
  })
})

describe('setActiveProviderProfile', () => {
  test('sets OPENAI_MODEL env var when switching to an openai-type provider', async () => {
    const { setActiveProviderProfile } =
      await importFreshProviderProfileModules()
    const openaiProfile = buildProfile({
      id: 'openai_prof',
      name: 'OpenAI Provider',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [openaiProfile],
    }))

    const result = setActiveProviderProfile('openai_prof')

    expect(result?.id).toBe('openai_prof')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
      'openai_prof',
    )
  })

  test('persists no-key openai-compatible profiles for restart fallback', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    process.chdir(tempDir)
    process.env.OPENAI_API_KEY = 'sk-shell-should-not-persist'

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const ollamaProfile = buildProfile({
        id: 'ollama_prof',
        name: 'Ollama',
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1:8b, qwen2.5:7b',
        apiKey: '',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [ollamaProfile],
      }))

      const result = setActiveProviderProfile('ollama_prof')
      const persisted = JSON.parse(
        readFileSync(join(tempDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('ollama_prof')
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_MODEL: 'llama3.1:8b',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('persists primary model for keyed openai-compatible multi-model profiles', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    process.chdir(tempDir)

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const deepSeekProfile = buildProfile({
        id: 'deepseek_prof',
        name: 'DeepSeek',
        provider: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash, deepseek-v4-pro, deepseek-chat',
        apiKey: 'sk-deepseek-live',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [deepSeekProfile],
      }))

      const result = setActiveProviderProfile('deepseek_prof')
      const persisted = JSON.parse(
        readFileSync(join(tempDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('deepseek_prof')
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
        OPENAI_MODEL: 'deepseek-v4-flash',
        OPENAI_API_KEY: 'sk-deepseek-live',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('sets ANTHROPIC_MODEL env var when switching to an anthropic-type provider', async () => {
    const { setActiveProviderProfile } =
      await importFreshProviderProfileModules()
    const anthropicProfile = buildProfile({
      id: 'anthro_prof',
      name: 'Anthropic Provider',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [anthropicProfile],
    }))

    const result = setActiveProviderProfile('anthro_prof')

    expect(result?.id).toBe('anthro_prof')
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
      'anthro_prof',
    )
  })

  test('clears openai model env and sets anthropic model env when switching from openai to anthropic provider', async () => {
    const { setActiveProviderProfile } =
      await importFreshProviderProfileModules()
    const openaiProfile = buildProfile({
      id: 'openai_prof',
      name: 'OpenAI Provider',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      apiKey: 'sk-openai-key',
    })
    const anthropicProfile = buildProfile({
      id: 'anthro_prof',
      name: 'Anthropic Provider',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-key',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [openaiProfile, anthropicProfile],
    }))

    // First activate the openai profile
    setActiveProviderProfile('openai_prof')
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')

    // Now switch to the anthropic profile
    const result = setActiveProviderProfile('anthro_prof')

    expect(result?.id).toBe('anthro_prof')
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
      'anthro_prof',
    )
  })

  test('clears anthropic model env and sets openai model env when switching from anthropic to openai provider', async () => {
    const { setActiveProviderProfile } =
      await importFreshProviderProfileModules()
    const anthropicProfile = buildProfile({
      id: 'anthro_prof',
      name: 'Anthropic Provider',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-key',
    })
    const openaiProfile = buildProfile({
      id: 'openai_prof',
      name: 'OpenAI Provider',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      apiKey: 'sk-openai-key',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [anthropicProfile, openaiProfile],
    }))

    // First activate the anthropic profile
    setActiveProviderProfile('anthro_prof')
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')

    // Now switch to the openai profile
    const result = setActiveProviderProfile('openai_prof')

    expect(result?.id).toBe('openai_prof')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
    // ANTHROPIC_MODEL is set to the profile model for all provider types
    expect(process.env.ANTHROPIC_MODEL).toBe('gpt-4o')
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
      'openai_prof',
    )
  })

  test('returns null for non-existent profile id', async () => {
    const { setActiveProviderProfile } =
      await importFreshProviderProfileModules()
    const openaiProfile = buildProfile({ id: 'existing_prof' })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [openaiProfile],
    }))

    const result = setActiveProviderProfile('nonexistent_prof')

    expect(result).toBeNull()
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

describe('getProfileModelOptions', () => {
  test('generates options for multi-model profile', async () => {
    const { getProfileModelOptions } =
      await importFreshProviderProfileModules()

    const options = getProfileModelOptions(
      buildProfile({
        name: 'Test Provider',
        model: 'glm-4.7, glm-4.7-flash, glm-4.7-plus',
      }),
    )

    expect(options).toEqual([
      { value: 'glm-4.7', label: 'glm-4.7', description: 'Provider: Test Provider' },
      { value: 'glm-4.7-flash', label: 'glm-4.7-flash', description: 'Provider: Test Provider' },
      { value: 'glm-4.7-plus', label: 'glm-4.7-plus', description: 'Provider: Test Provider' },
    ])
  })

  test('generates options for semicolon-separated multi-model profile', async () => {
    const { getProfileModelOptions } =
      await importFreshProviderProfileModules()

    const options = getProfileModelOptions(
      buildProfile({
        name: 'Test Provider',
        model: 'glm-4.7; glm-4.7-flash; glm-4.7-plus',
      }),
    )

    expect(options).toEqual([
      { value: 'glm-4.7', label: 'glm-4.7', description: 'Provider: Test Provider' },
      { value: 'glm-4.7-flash', label: 'glm-4.7-flash', description: 'Provider: Test Provider' },
      { value: 'glm-4.7-plus', label: 'glm-4.7-plus', description: 'Provider: Test Provider' },
    ])
  })

  test('returns single option for single-model profile', async () => {
    const { getProfileModelOptions } =
      await importFreshProviderProfileModules()

    const options = getProfileModelOptions(
      buildProfile({
        name: 'Single Model',
        model: 'llama3.1:8b',
      }),
    )

    expect(options).toEqual([
      { value: 'llama3.1:8b', label: 'llama3.1:8b', description: 'Provider: Single Model' },
    ])
  })

  test('returns empty array for empty model field', async () => {
    const { getProfileModelOptions } =
      await importFreshProviderProfileModules()

    const options = getProfileModelOptions(
      buildProfile({
        name: 'Empty',
        model: '',
      }),
    )

    expect(options).toEqual([])
  })
})

describe('setActiveProviderProfile model cache', () => {
  test('populates model cache with all models from multi-model profile on activation', async () => {
    const {
      setActiveProviderProfile,
      getActiveOpenAIModelOptionsCache,
    } = await importFreshProviderProfileModules()

    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [
        buildProfile({
          id: 'multi_provider',
          name: 'Multi Provider',
          model: 'glm-4.7, glm-4.7-flash, glm-4.7-plus',
          baseUrl: 'https://api.example.com/v1',
        }),
      ],
    }

    setActiveProviderProfile('multi_provider')

    const cache = getActiveOpenAIModelOptionsCache()
    const cacheValues = cache.map(opt => opt.value)
    expect(cacheValues).toContain('glm-4.7')
    expect(cacheValues).toContain('glm-4.7-flash')
    expect(cacheValues).toContain('glm-4.7-plus')
  })
})

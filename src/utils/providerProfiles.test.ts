import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { acquireEnvMutex, releaseEnvMutex } from '../entrypoints/sdk/shared.js'
import type { ProviderProfile } from './config.js'

async function importFreshProvidersModule() {
  return import(`./model/providers.ts?ts=${Date.now()}-${Math.random()}`)
}

const originalEnv = { ...process.env }
const originalCwd = process.cwd()

const RESTORED_KEYS = [
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'CLAUDE_CONFIG_DIR',
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
  'OPENAI_API_FORMAT',
  'OPENAI_AUTH_HEADER',
  'OPENAI_AUTH_SCHEME',
  'OPENAI_AUTH_HEADER_VALUE',
  'OPENAI_API_KEY',
  'GITHUB_COPILOT_KEY',
  'GITHUB_ENTERPRISE_URL',
  'CODEX_API_KEY',
  'CODEX_CREDENTIAL_SOURCE',
  'CHATGPT_ACCOUNT_ID',
  'CODEX_ACCOUNT_ID',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_VERTEX_BASE_URL',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_AUTH_MODE',
  'GEMINI_ACCESS_TOKEN',
  'GOOGLE_API_KEY',
  'MISTRAL_BASE_URL',
  'MISTRAL_MODEL',
  'MISTRAL_API_KEY',
  'MINIMAX_API_KEY',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'BANKR_BASE_URL',
  'BNKR_API_KEY',
  'BANKR_MODEL',
  'XAI_API_KEY',
  'VENICE_API_KEY',
  'MIMO_API_KEY',
  'ATLAS_CLOUD_API_KEY',
  'HICAP_API_KEY',
  'CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS',
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
let testConfigDir: string | null = null

function saveMockGlobalConfig(
  updater: (current: MockConfigState) => MockConfigState,
): void {
  mockConfigState = updater(mockConfigState)
}

beforeEach(async () => {
  await acquireEnvMutex()
  for (const key of RESTORED_KEYS) {
    delete process.env[key]
  }
  testConfigDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
  process.env.CLAUDE_CONFIG_DIR = testConfigDir
})

afterEach(() => {
  try {
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
    if (testConfigDir) {
      rmSync(testConfigDir, { recursive: true, force: true })
      testConfigDir = null
    }
  } finally {
    releaseEnvMutex()
  }
})

async function importFreshProviderProfileModules() {
  mock.restore()
  const actualConfig = await import(`./config.js?ts=${Date.now()}-${Math.random()}`)
  mock.module('./config.js', () => ({
    ...actualConfig,
    // Spread the real config so the mock stays a COMPLETE GlobalConfig and only
    // the provider-profile fields are overridden. bun's mock.restore() does NOT
    // revert mock.module(), so this replacement leaks into later test files in
    // the same process; returning a partial object (missing e.g.
    // autoCompactEnabled) silently broke unrelated suites that read other config
    // fields via getGlobalConfig().
    getGlobalConfig: () => ({
      ...actualConfig.getGlobalConfig(),
      ...mockConfigState,
    }),
    saveGlobalConfig: (
      updater: (current: MockConfigState) => MockConfigState,
    ) => {
      mockConfigState = updater(mockConfigState)
    },
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  const registry = await import('../integrations/registry.js')
  registry._clearRegistryForTesting()
  await import(`../integrations/index.js?ts=${nonce}`)
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

function buildXaiProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return buildProfile({
    provider: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4',
    apiKey: 'xai-test-key',
    ...overrides,
  })
}

function buildVeniceProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return buildProfile({
    provider: 'venice',
    name: 'Venice',
    baseUrl: 'https://api.venice.ai/api/v1',
    model: 'venice-uncensored',
    apiKey: 'venice-test-key',
    ...overrides,
  })
}

function buildXiaomiMimoProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return buildProfile({
    provider: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    apiKey: 'mimo-test-key',
    ...overrides,
  })
}

function buildFireworksProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return buildProfile({
    provider: 'fireworks',
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    model: 'accounts/fireworks/models/deepseek-v3',
    apiKey: 'fireworks-test-key',
    ...overrides,
  })
}

function buildAtlasCloudProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return buildProfile({
    provider: 'atlas-cloud',
    name: 'Atlas Cloud',
    baseUrl: 'https://api.atlascloud.ai/v1',
    model: 'deepseek-ai/deepseek-v4-pro',
    apiKey: 'atlas-test-key',
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

  test('bedrock profile sets CLAUDE_CODE_USE_BEDROCK and preserves anthropic model routing', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'bedrock',
        baseUrl: 'https://bedrock-proxy.example',
        model: 'claude-sonnet-4-6',
      }),
    )
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
    expect(process.env.ANTHROPIC_BEDROCK_BASE_URL).toBe(
      'https://bedrock-proxy.example',
    )
    expect(getFreshAPIProvider()).toBe('bedrock')
  })

  test('github profile sets CLAUDE_CODE_USE_GITHUB instead of generic openai mode', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'github',
        baseUrl: 'https://models.github.ai/inference',
        model: 'github:copilot',
      }),
    )
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://models.github.ai/inference',
    )
    expect(process.env.OPENAI_MODEL).toBe('github:copilot')
    expect(getFreshAPIProvider()).toBe('github')
  })

  test('github-enterprise profile uses GitHub compatibility env', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'github-enterprise',
        baseUrl: 'https://github.mycompany.com/api/copilot',
        model: 'github:copilot:gpt-5.3-codex',
        apiKey: 'enterprise-profile-key',
      }),
    )
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()
    const { resolveProviderRequest } = await import(
      `../services/api/providerConfig.ts?ts=${Date.now()}-${Math.random()}`
    )

    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://github.mycompany.com/api/copilot',
    )
    expect(process.env.GITHUB_ENTERPRISE_URL).toBe(
      'https://github.mycompany.com',
    )
    expect(process.env.GITHUB_COPILOT_KEY).toBe('enterprise-profile-key')
    expect(process.env.OPENAI_MODEL).toBe('github:copilot:gpt-5.3-codex')
    expect(getFreshAPIProvider()).toBe('github')
    expect(resolveProviderRequest()).toMatchObject({
      baseUrl: 'https://github.mycompany.com/api/copilot',
      resolvedModel: 'gpt-5.3-codex',
      transport: 'codex_responses',
    })
  })

  test('github-enterprise profile does not derive Enterprise URL from public Copilot default', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'github-enterprise',
        baseUrl: 'https://api.githubcopilot.com',
        model: 'github:copilot:gpt-5.3-codex',
      }),
    )

    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.githubcopilot.com')
    expect(process.env.GITHUB_ENTERPRISE_URL).toBeUndefined()
  })

  test('github-enterprise profile remains aligned only with Enterprise env', async () => {
    const {
      applyActiveProviderProfileFromConfig,
      applyProviderProfileToProcessEnv,
    } = await importFreshProviderProfileModules()
    const activeProfile = buildProfile({
      id: 'github_enterprise_prof',
      provider: 'github-enterprise',
      baseUrl: 'https://github.mycompany.com/api/copilot',
      model: 'github:copilot:gpt-5.3-codex',
      apiKey: 'enterprise-profile-key',
    })

    applyProviderProfileToProcessEnv(activeProfile)
    const unchanged = applyActiveProviderProfileFromConfig({
      providerProfiles: [activeProfile],
      activeProviderProfileId: activeProfile.id,
    } as any)

    expect(unchanged?.id).toBe(activeProfile.id)
    expect(process.env.GITHUB_ENTERPRISE_URL).toBe(
      'https://github.mycompany.com',
    )

    delete process.env.GITHUB_ENTERPRISE_URL
    const updated = applyActiveProviderProfileFromConfig({
      providerProfiles: [activeProfile],
      activeProviderProfileId: activeProfile.id,
    } as any)

    expect(updated?.id).toBe(activeProfile.id)
    expect(String(process.env.GITHUB_ENTERPRISE_URL)).toBe(
      'https://github.mycompany.com',
    )
  })

  test('github-enterprise profile persists and relaunches with Enterprise env', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const enterpriseProfile = buildProfile({
        id: 'github_enterprise_persisted',
        name: 'GitHub Enterprise',
        provider: 'github-enterprise',
        baseUrl: 'https://github.mycompany.com/api/copilot',
        model: 'github:copilot:gpt-5.3-codex',
        apiKey: 'enterprise-profile-key',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [enterpriseProfile],
      }))

      const result = setActiveProviderProfile('github_enterprise_persisted', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('github_enterprise_persisted')
      expect(persisted.profile).toBe('github-enterprise')
      expect(persisted.env).toMatchObject({
        GITHUB_ENTERPRISE_URL: 'https://github.mycompany.com',
        GITHUB_COPILOT_KEY: 'enterprise-profile-key',
        OPENAI_BASE_URL: 'https://github.mycompany.com/api/copilot',
        OPENAI_MODEL: 'github:copilot:gpt-5.3-codex',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('nvidia-nim profile keeps openai-compatible routing but stamps NVIDIA_NIM', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'nvidia-nim',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/llama-3.1-nemotron-70b-instruct',
        apiKey: 'nvapi-test',
      }),
    )

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://integrate.api.nvidia.com/v1',
    )
    expect(process.env.OPENAI_MODEL).toBe(
      'nvidia/llama-3.1-nemotron-70b-instruct',
    )
    expect(process.env.OPENAI_API_KEY).toBe('nvapi-test')
    expect(process.env.NVIDIA_API_KEY).toBe('nvapi-test')
    expect(process.env.NVIDIA_NIM).toBe('1')
  })

  test('provider profile apply clears stale codex-managed credentials', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CODEX_API_KEY = 'codex-stale'
    process.env.CODEX_CREDENTIAL_SOURCE = 'oauth'
    process.env.CHATGPT_ACCOUNT_ID = 'acct-stale'
    process.env.CODEX_ACCOUNT_ID = 'acct-stale-legacy'

    applyProviderProfileToProcessEnv(buildProfile())

    expect(process.env.CODEX_API_KEY).toBeUndefined()
    expect(process.env.CODEX_CREDENTIAL_SOURCE).toBeUndefined()
    expect(process.env.CHATGPT_ACCOUNT_ID).toBeUndefined()
    expect(process.env.CODEX_ACCOUNT_ID).toBeUndefined()
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

  test('openai responses profile sets OPENAI_API_FORMAT', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
        apiFormat: 'responses',
      }),
    )

    expect(process.env.OPENAI_MODEL).toBe('gpt-5.4')
    expect(process.env.OPENAI_API_FORMAT).toBe('responses')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
  })

  test('openai responses_compat profile sets OPENAI_API_FORMAT', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
        apiFormat: 'responses_compat',
      }),
    )

    expect(process.env.OPENAI_MODEL).toBe('gpt-5.4')
    expect(process.env.OPENAI_API_FORMAT).toBe('responses_compat')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
  })

  test('custom OpenAI-compatible responses profile sets OPENAI_API_FORMAT', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'custom',
        baseUrl: 'https://custom.example/v1',
        model: 'custom-responses-model',
        apiFormat: 'responses',
      }),
    )

    expect(process.env.OPENAI_MODEL).toBe('custom-responses-model')
    expect(process.env.OPENAI_BASE_URL).toBe('https://custom.example/v1')
    expect(process.env.OPENAI_API_FORMAT).toBe('responses')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
  })

  test('openai profile sets custom auth header name and value', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://api.hicap.ai/v1',
        model: 'claude-opus-4.7',
        authHeader: 'api-key',
        authScheme: 'raw',
        authHeaderValue: 'hicap-header-value',
      }),
    )

    expect(process.env.OPENAI_AUTH_HEADER).toBe('api-key')
    expect(process.env.OPENAI_AUTH_SCHEME).toBe('raw')
    expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBe('hicap-header-value')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
  })

  test('minimax profile ignores advanced OpenAI-compatible auth settings', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'minimax',
        baseUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M2.7',
        apiKey: 'minimax-live-key',
        apiFormat: 'responses',
        authHeader: 'api-key',
        authScheme: 'raw',
        authHeaderValue: 'minimax-header-value',
        customHeaders: {
          'X-Team': 'devtools',
        },
      }),
    )

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.minimax.io/anthropic')
    expect(process.env.ANTHROPIC_MODEL).toBe('MiniMax-M2.7')
    expect(process.env.ANTHROPIC_API_KEY).toBe('minimax-live-key')
    expect(process.env.MINIMAX_API_KEY).toBe('minimax-live-key')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_API_FORMAT).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
    expect(process.env.OPENAI_AUTH_SCHEME).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })

  test('venice profile applies OpenAI-compatible env with VENICE_API_KEY mirror', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'

    applyProviderProfileToProcessEnv(buildVeniceProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.venice.ai/api/v1')
    expect(process.env.OPENAI_MODEL).toBe('venice-uncensored')
    expect(process.env.OPENAI_API_KEY).toBe('venice-test-key')
    expect(process.env.VENICE_API_KEY).toBe('venice-test-key')
    expect(getFreshAPIProvider()).toBe('openai')
  })

  test('xiaomi mimo profile applies OpenAI-compatible env with MIMO_API_KEY mirror', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'

    applyProviderProfileToProcessEnv(buildXiaomiMimoProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.xiaomimimo.com/v1')
    expect(process.env.OPENAI_MODEL).toBe('mimo-v2.5-pro')
    expect(process.env.OPENAI_API_KEY).toBe('mimo-test-key')
    expect(process.env.MIMO_API_KEY).toBe('mimo-test-key')
    expect(getFreshAPIProvider()).toBe('xiaomi-mimo')
  })

  test('atlas cloud profile applies OpenAI-compatible env with ATLAS_CLOUD_API_KEY mirror', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'

    applyProviderProfileToProcessEnv(buildAtlasCloudProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.atlascloud.ai/v1')
    expect(process.env.OPENAI_MODEL).toBe('deepseek-ai/deepseek-v4-pro')
    expect(process.env.OPENAI_API_KEY).toBe('atlas-test-key')
    expect(process.env.ATLAS_CLOUD_API_KEY).toBe('atlas-test-key')
    expect(getFreshAPIProvider()).toBe('openai')
  })

  test('xiaomi mimo profile normalizes stale docs endpoint to resolving API host', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(buildXiaomiMimoProfile({
      baseUrl: 'https://api.mimo-v2.com/v1',
    }))
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.OPENAI_BASE_URL).toBe('https://api.xiaomimimo.com/v1')
    expect(process.env.MIMO_API_KEY).toBe('mimo-test-key')
    expect(getFreshAPIProvider()).toBe('xiaomi-mimo')
  })

  test('fireworks profile applies OpenAI-compatible env with FIREWORKS_API_KEY mirror', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'

    applyProviderProfileToProcessEnv(buildFireworksProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://api.fireworks.ai/inference/v1',
    )
    expect(process.env.OPENAI_MODEL).toBe(
      'accounts/fireworks/models/deepseek-v3',
    )
    expect(process.env.OPENAI_API_KEY).toBe('fireworks-test-key')
    expect(process.env.FIREWORKS_API_KEY).toBe('fireworks-test-key')
    expect(getFreshAPIProvider()).toBe('openai')
  })

  test('legacy OpenAI profile on restricted route ignores advanced settings', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://api.kimi.com/coding/v1',
        model: 'kimi-for-coding',
        apiKey: 'kimi-live-key',
        apiFormat: 'responses',
        authHeader: 'api-key',
        authScheme: 'raw',
        authHeaderValue: 'kimi-header-value',
        customHeaders: {
          'X-Team': 'devtools',
        },
      }),
    )

    expect(process.env.OPENAI_BASE_URL).toBe('https://api.kimi.com/coding/v1')
    expect(process.env.OPENAI_MODEL).toBe('kimi-for-coding')
    expect(process.env.OPENAI_API_KEY).toBe('kimi-live-key')
    expect(process.env.OPENAI_API_FORMAT).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
    expect(process.env.OPENAI_AUTH_SCHEME).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })

  test('supported routes apply sanitized profile custom headers to env', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'custom',
        baseUrl: 'https://custom.example/v1',
        customHeaders: {
          'X-Team': 'devtools',
          'X-Trace': 'enabled',
        },
      }),
    )

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
      'X-Team: devtools\nX-Trace: enabled',
    )
  })

  test('supported routes still reject managed custom headers', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'custom',
        baseUrl: 'https://custom.example/v1',
        customHeaders: {
          'api-key': 'managed-provider-key',
          'X-Team': 'devtools',
        },
      }),
    )

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })

  test('unsupported routes do not apply profile custom headers to env', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        customHeaders: {
          'X-Team': 'devtools',
        },
      }),
    )

    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
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

  test('xai profile sets XAI_API_KEY and getAPIProvider returns xai', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(buildXaiProfile())
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(String(process.env.XAI_API_KEY)).toBe('xai-test-key')
    expect(getFreshAPIProvider()).toBe('xai')
  })

  test('does not mirror XAI_API_KEY for a lookalike host containing "x.ai"', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    // `vertex.ai` contains the substring "x.ai"; a raw includes() check would
    // wrongly treat this OpenAI-compatible profile as xAI and mirror the key
    // into XAI_API_KEY. Host matching must be by hostname (api.x.ai), not
    // substring.
    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://vertex.ai/v1',
        model: 'some-model',
        apiKey: 'not-an-xai-key',
      }),
    )
    const { getAPIProvider: getFreshAPIProvider } =
      await importFreshProvidersModule()

    expect(process.env.XAI_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBe('not-an-xai-key')
    expect(getFreshAPIProvider()).not.toBe('xai')
  })

  test('openai-compatible profile applies maxContextLength env override', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'custom',
        baseUrl: 'http://localhost:4000/v1',
        model: 'gpt-4o',
        maxContextLength: 200_000,
      }),
    )

    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:4000/v1')
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
    expect(process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS).toBe(
      JSON.stringify({ 'gpt-4o': 200_000 }),
    )
  })

  test('openai-compatible profile switch clears previous same-model context override', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    const { resolveModelRuntimeLimits } = await import(
      '../integrations/runtimeMetadata.js'
    )

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'custom',
        baseUrl: 'http://localhost:4000/v1',
        model: 'gpt-4o',
        maxContextLength: 1_000_000,
      }),
    )
    expect(
      resolveModelRuntimeLimits({
        model: 'gpt-4o',
        processEnv: process.env,
      }).contextWindow,
    ).toBe(1_000_000)

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      }),
    )

    expect(process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS).toBeUndefined()
    expect(
      resolveModelRuntimeLimits({
        model: 'gpt-4o',
        processEnv: process.env,
      }).contextWindow,
    ).not.toBe(1_000_000)
  })

  test('non-openai-compatible profile ignores maxContextLength override', async () => {
    const { applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()

    applyProviderProfileToProcessEnv(
      buildProfile({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
        maxContextLength: 200_000,
      }),
    )

    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
    expect(process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS).toBeUndefined()
  })
})

describe('getProviderProfiles', () => {
  test('preserves unknown stored provider ids during sanitization', async () => {
    const { getProviderProfiles } = await importFreshProviderProfileModules()

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [
        buildProfile({
          id: 'moonshot_vendor_prof',
          name: 'Moonshot Vendor',
          provider: 'moonshot',
          baseUrl: 'https://api.moonshot.ai/v1',
          model: 'kimi-k2.5',
        }),
      ],
    }))

    const profiles = getProviderProfiles()

    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.provider).toBe('moonshot')
  })

  test('sanitizes maxContextLength to positive finite integers', async () => {
    const { getProviderProfiles } = await importFreshProviderProfileModules()

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [
        buildProfile({ id: 'valid', maxContextLength: 128_000 }),
        buildProfile({ id: 'negative', maxContextLength: -1 }),
        buildProfile({ id: 'float', maxContextLength: 128_000.5 }),
        buildProfile({ id: 'zero', maxContextLength: 0 }),
        buildProfile({ id: 'infinity', maxContextLength: Infinity }),
        buildProfile({ id: 'string', maxContextLength: '128000' as unknown as number }),
        buildProfile({ id: 'missing' }),
      ],
    }))

    const profiles = getProviderProfiles()

    const byId = (id: string) => profiles.find(p => p.id === id)
    expect(byId('valid')?.maxContextLength).toBe(128_000)
    expect(byId('negative')?.maxContextLength).toBeUndefined()
    expect(byId('float')?.maxContextLength).toBeUndefined()
    expect(byId('zero')?.maxContextLength).toBeUndefined()
    expect(byId('infinity')?.maxContextLength).toBeUndefined()
    expect(byId('string')?.maxContextLength).toBeUndefined()
    expect(byId('missing')?.maxContextLength).toBeUndefined()
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

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_MISTRAL
    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_FORMAT
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
    expect(process.env.OPENAI_BASE_URL!).toBe('https://api.moonshot.ai/v1')
    expect(process.env.OPENAI_MODEL!).toBe('kimi-k2.6')
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

  test('respects env-only GitHub Enterprise startup selection', async () => {
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.GITHUB_ENTERPRISE_URL = 'https://github.mycompany.com/api/copilot'
    process.env.GITHUB_COPILOT_KEY = 'enterprise-direct-key'
    delete process.env.OPENAI_MODEL

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
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(process.env.GITHUB_ENTERPRISE_URL).toBe(
      'https://github.mycompany.com/api/copilot',
    )
    expect(process.env.GITHUB_COPILOT_KEY).toBe('enterprise-direct-key')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
  })

  test('does not override explicit env-only MiniMax selection with saved profile', async () => {
    const { applyActiveProviderProfileFromConfig } =
      await importFreshProviderProfileModules()
    process.env.MINIMAX_API_KEY = 'minimax-live-key'
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic'
    process.env.ANTHROPIC_MODEL = 'MiniMax-M2.7'

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
    expect(process.env.MINIMAX_API_KEY).toBe('minimax-live-key')
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      'https://api.minimax.io/anthropic',
    )
    expect(process.env.ANTHROPIC_MODEL).toBe('MiniMax-M2.7')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
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

  test('re-applies active profile when context-window override drifts', async () => {
    const { applyActiveProviderProfileFromConfig, applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    const activeProfile = buildProfile({
      id: 'saved_openai',
      baseUrl: 'http://localhost:4000/v1',
      model: 'gpt-4o',
      maxContextLength: 1_000_000,
    })
    applyProviderProfileToProcessEnv(activeProfile)

    // Simulate an upgraded or partially restored process where the profile
    // marker and core OpenAI env survived, but this PR's new override did not.
    delete process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [activeProfile],
      activeProviderProfileId: 'saved_openai',
    } as any)

    expect(applied?.id).toBe('saved_openai')
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:4000/v1')
    expect(String(process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS)).toBe(
      JSON.stringify({ 'gpt-4o': 1_000_000 }),
    )
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

  test('re-applies xai active profile when XAI_API_KEY is missing (env drift)', async () => {
    const { applyActiveProviderProfileFromConfig, applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    const xaiProfile = buildXaiProfile({ id: 'saved_xai' })
    applyProviderProfileToProcessEnv(xaiProfile)

    // Simulate relaunch where the shell exported OPENAI vars but not XAI_API_KEY
    delete process.env.XAI_API_KEY

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [xaiProfile],
      activeProviderProfileId: 'saved_xai',
    } as any)

    expect(applied?.id).toBe('saved_xai')
    expect(String(process.env.XAI_API_KEY)).toBe('xai-test-key')
  })

  test('re-applies Fireworks AI active profile when FIREWORKS_API_KEY is missing (env drift)', async () => {
    const { applyActiveProviderProfileFromConfig, applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    const fwProfile = buildFireworksProfile({ id: 'saved_fw' })
    applyProviderProfileToProcessEnv(fwProfile)

    // Simulate relaunch where the shell exported OPENAI vars but not FIREWORKS_API_KEY
    delete process.env.FIREWORKS_API_KEY

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [fwProfile],
      activeProviderProfileId: 'saved_fw',
    } as any)

    expect(applied?.id).toBe('saved_fw')
    expect(String(process.env.FIREWORKS_API_KEY)).toBe('fireworks-test-key')
  })

  test('does not re-apply xai active profile when XAI_API_KEY is aligned', async () => {
    const { applyActiveProviderProfileFromConfig, applyProviderProfileToProcessEnv } =
      await importFreshProviderProfileModules()
    const xaiProfile = buildXaiProfile({ id: 'saved_xai' })
    applyProviderProfileToProcessEnv(xaiProfile)

    // XAI_API_KEY is already set and aligned
    expect(process.env.XAI_API_KEY).toBe('xai-test-key')
    expect(process.env.OPENAI_API_KEY).toBe('xai-test-key')

    const applied = applyActiveProviderProfileFromConfig({
      providerProfiles: [xaiProfile],
      activeProviderProfileId: 'saved_xai',
    } as any)

    // Returns profile without re-applying since env is aligned
    expect(applied?.id).toBe('saved_xai')
    expect(process.env.XAI_API_KEY).toBe('xai-test-key')
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
  // The runtime active-model selection is owned by mainLoopModelOverride
  // (set by onChangeAppState before this helper is called). This helper
  // intentionally no longer mutates the profile's model list — see the
  // docstring in providerProfiles.ts. Coverage below locks the no-op
  // contract for both single- and multi-model profiles.
  test('returns the active profile unchanged for a single-model profile', async () => {
    const {
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

    const updated = persistActiveProviderProfileModel('minimax-m2.5:cloud')

    expect(updated?.id).toBe(activeProfile.id)
    expect(updated?.model).toBe('kimi-k2.5:cloud')
    const saved = getProviderProfiles().find(
      (profile: ProviderProfile) => profile.id === activeProfile.id,
    )
    expect(saved?.model).toBe('kimi-k2.5:cloud')
  })

  test('does not mutate multi-model mistral profile when chosen model is out of list', async () => {
    // Regression for #1360: the picker must never silently rewrite a
    // provider's configured model list. The active model is a session-level
    // choice handled by mainLoopModelOverride; the profile's model list
    // only changes via an explicit provider edit. An earlier
    // implementation prepended the chosen model to the list, which
    // contradicted the documented contract and grew the list unboundedly
    // on rotation.
    const {
      applyProviderProfileToProcessEnv,
      getProviderProfiles,
      persistActiveProviderProfileModel,
    } = await importFreshProviderProfileModules()
    const activeProfile = buildMistralProfile({
      id: 'saved_mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'devstral-latest; mistral-small-latest',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [activeProfile],
      activeProviderProfileId: activeProfile.id,
    }))
    applyProviderProfileToProcessEnv(activeProfile)

    const updated = persistActiveProviderProfileModel('mistral-large-latest')

    expect(updated?.id).toBe(activeProfile.id)
    // The configured list is preserved verbatim regardless of the chosen
    // model being in or out of the list.
    expect(updated?.model).toBe('devstral-latest; mistral-small-latest')
    expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
      activeProfile.id,
    )

    const saved = getProviderProfiles().find(
      (profile: ProviderProfile) => profile.id === activeProfile.id,
    )
    expect(saved?.model).toBe('devstral-latest; mistral-small-latest')
  })

  test('preserves comma-separated multi-model list when chosen model is already a member', async () => {
    // Switching between models already in the list is a session-level
    // choice. The list itself must be preserved exactly as configured.
    const {
      getProviderProfiles,
      persistActiveProviderProfileModel,
    } = await importFreshProviderProfileModules()
    const activeProfile = buildMistralProfile({
      id: 'saved_mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'devstral-latest, mistral-small-latest, mistral-large-latest',
    })

    saveMockGlobalConfig(current => ({
      ...current,
      providerProfiles: [activeProfile],
      activeProviderProfileId: activeProfile.id,
    }))

    const updated = persistActiveProviderProfileModel('mistral-small-latest')

    expect(updated?.model).toBe(
      'devstral-latest, mistral-small-latest, mistral-large-latest',
    )
    const saved = getProviderProfiles().find(
      (profile: ProviderProfile) => profile.id === activeProfile.id,
    )
    expect(saved?.model).toBe(
      'devstral-latest, mistral-small-latest, mistral-large-latest',
    )
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

    expect(defaults.provider).toBe('atomic-chat')
    expect(defaults.name).toBe('Atomic Chat')
    expect(defaults.baseUrl).toBe('http://127.0.0.1:1337/v1')
    expect(defaults.requiresApiKey).toBe(false)
  })

  test('kimi-code preset defaults to the Kimi Code coding endpoint', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('kimi-code')

    expect(defaults.provider).toBe('kimi-code')
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
  test('deepseek preset defaults to DeepSeek V4 Pro', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('deepseek')

    expect(defaults.provider).toBe('deepseek')
    expect(defaults.name).toBe('DeepSeek')
    expect(defaults.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(defaults.model).toBe('deepseek-v4-pro')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('hicap preset defaults to the Hicap endpoint', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    process.env.HICAP_API_KEY = 'hicap-live-key'

    const defaults = getProviderPresetDefaults('hicap')

    expect(defaults.provider).toBe('hicap')
    expect(defaults.name).toBe('Hicap')
    expect(defaults.baseUrl).toBe('https://api.hicap.ai/v1')
    expect(defaults.model).toBe('claude-opus-4.7')
    expect(defaults.apiKey).toBe('hicap-live-key')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('minimax preset defaults to MiniMax M3', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('minimax')

    expect(defaults.provider).toBe('minimax')
    expect(defaults.name).toBe('MiniMax')
    expect(defaults.baseUrl).toBe('https://api.minimax.io/anthropic')
    expect(defaults.model).toBe('MiniMax-M3')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('venice preset defaults to the official Venice endpoint', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    process.env.VENICE_API_KEY = 'venice-live-key'

    const defaults = getProviderPresetDefaults('venice')

    expect(defaults.provider).toBe('venice')
    expect(defaults.name).toBe('Venice')
    expect(defaults.baseUrl).toBe('https://api.venice.ai/api/v1')
    expect(defaults.model).toBe('venice-uncensored')
    expect(defaults.apiKey).toBe('venice-live-key')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('xiaomi mimo preset defaults to the official Xiaomi MiMo endpoint', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    process.env.MIMO_API_KEY = 'mimo-live-key'

    const defaults = getProviderPresetDefaults('xiaomi-mimo')

    expect(defaults.provider).toBe('xiaomi-mimo')
    expect(defaults.name).toBe('Xiaomi MiMo')
    expect(defaults.baseUrl).toBe('https://api.xiaomimimo.com/v1')
    expect(defaults.model).toBe('mimo-v2.5-pro')
    expect(defaults.apiKey).toBe('mimo-live-key')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('xai preset ignores stale generic OpenAI model when creating defaults', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()
    process.env.OPENAI_MODEL = 'gpt-5.4'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.XAI_API_KEY = 'xai-live-key'

    const defaults = getProviderPresetDefaults('xai')

    expect(defaults.provider).toBe('xai')
    expect(defaults.name).toBe('xAI')
    expect(defaults.baseUrl).toBe('https://api.x.ai/v1')
    expect(defaults.model).toBe('grok-4.3')
    expect(defaults.apiKey).toBe('xai-live-key')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('zai preset defaults to Z.AI GLM Coding Plan endpoint', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('zai')

    expect(defaults.provider).toBe('zai')
    expect(defaults.name).toBe('Z.AI - GLM Coding Plan')
    expect(defaults.baseUrl).toBe('https://api.z.ai/api/coding/paas/v4')
    expect(defaults.model).toBe('GLM-5.1')
    expect(defaults.requiresApiKey).toBe(true)
  })

  test('fireworks preset defaults to the official Fireworks AI endpoint', async () => {
    const { getProviderPresetDefaults } =
      await importFreshProviderProfileModules()
    process.env.FIREWORKS_API_KEY = 'fireworks-live-key'

    const defaults = getProviderPresetDefaults('fireworks')

    expect(defaults.provider).toBe('fireworks')
    expect(defaults.name).toBe('Fireworks AI')
    expect(defaults.baseUrl).toBe('https://api.fireworks.ai/inference/v1')
    expect(defaults.model).toBe(
      'accounts/fireworks/models/llama-v3p1-70b-instruct',
    )
    expect(defaults.apiKey).toBe('fireworks-live-key')
    expect(defaults.requiresApiKey).toBe(true)
  })
})

describe('setActiveProviderProfile', () => {
  test('sets OPENAI_MODEL env var when switching to an openai-type provider', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
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

      const result = setActiveProviderProfile('openai_prof', {
        configDir: testConfigDir ?? undefined,
      })

      expect(result?.id).toBe('openai_prof')
      expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
      expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
      expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
      expect(process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBe(
        'openai_prof',
      )
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  // xAI OAuth profile (provider='xai', no API key) must persist the
  // startup file as profile='xai' with XAI_CREDENTIAL_SOURCE='oauth' so
  // (a) startup validation accepts it without XAI_API_KEY, and (b)
  // clearPersistedXaiOAuthProfile() can find and remove it on logout.
  // Regression: previously written as profile='openai' with no marker,
  // leaving a stale startup file that hit the missing-cred warning on
  // every non-interactive launch after logout.
  test('persists xAI OAuth profile with marker so logout cleanup can clear it', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const { clearPersistedXaiOAuthProfile, isPersistedXaiOAuthProfile } =
        await import('./providerProfile.js')

      const xaiOAuthProfile = buildProfile({
        id: 'xai_oauth_prof',
        name: 'xAI OAuth',
        provider: 'xai',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-4.3',
        apiKey: '',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [xaiOAuthProfile],
      }))

      const result = setActiveProviderProfile('xai_oauth_prof', { configDir })
      const profilePath = join(configDir, '.openclaude-profile.json')
      const persisted = JSON.parse(readFileSync(profilePath, 'utf8'))

      expect(result?.id).toBe('xai_oauth_prof')
      expect(persisted.profile).toBe('xai')
      expect(persisted.env.XAI_CREDENTIAL_SOURCE).toBe('oauth')
      expect(persisted.env.OPENAI_BASE_URL).toBe('https://api.x.ai/v1')
      expect(persisted.env.OPENAI_MODEL).toBe('grok-4.3')
      // No leaked API key fields.
      expect(persisted.env.OPENAI_API_KEY).toBeUndefined()
      expect(persisted.env.XAI_API_KEY).toBeUndefined()

      // Logout cleanup recognises and removes the marker-tagged file.
      expect(isPersistedXaiOAuthProfile(persisted)).toBe(true)
      const removed = clearPersistedXaiOAuthProfile({ configDir })
      expect(removed).toBe(profilePath)
      expect(existsSync(profilePath)).toBe(false)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists no-key openai-compatible profiles for restart fallback', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
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

      const result = setActiveProviderProfile('ollama_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('ollama_prof')
      expect(existsSync(join(tempDir, '.openclaude-profile.json'))).toBe(false)
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_MODEL: 'llama3.1:8b',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists primary model for keyed openai-compatible multi-model profiles', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

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
        apiFormat: 'responses',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [deepSeekProfile],
      }))

      const result = setActiveProviderProfile('deepseek_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('deepseek_prof')
      expect(existsSync(join(tempDir, '.openclaude-profile.json'))).toBe(false)
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
        OPENAI_MODEL: 'deepseek-v4-flash',
        OPENAI_API_KEY: 'sk-deepseek-live',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists descriptor-backed direct vendors using a legacy-compatible openai startup profile', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const deepSeekProfile = buildProfile({
        id: 'deepseek_vendor_prof',
        name: 'DeepSeek Vendor',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'sk-deepseek-live',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [deepSeekProfile],
      }))

      const result = setActiveProviderProfile('deepseek_vendor_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('deepseek_vendor_prof')
      expect(existsSync(join(tempDir, '.openclaude-profile.json'))).toBe(false)
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
        OPENAI_MODEL: 'deepseek-chat',
        OPENAI_API_KEY: 'sk-deepseek-live',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists the Atlas key for generic openai profiles targeting Atlas Cloud', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const genericAtlasProfile = buildProfile({
        id: 'generic_atlas_prof',
        name: 'Atlas via custom OpenAI',
        baseUrl: 'https://api.atlascloud.ai/v1',
        model: 'deepseek-ai/deepseek-v4-pro',
        apiKey: 'atlas-generic-key',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [genericAtlasProfile],
      }))

      const result = setActiveProviderProfile('generic_atlas_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('generic_atlas_prof')
      expect(persisted.profile).toBe('openai')
      expect(persisted.env.OPENAI_BASE_URL).toBe('https://api.atlascloud.ai/v1')
      expect(persisted.env.OPENAI_API_KEY).toBe('atlas-generic-key')
      expect(persisted.env.ATLAS_CLOUD_API_KEY).toBe('atlas-generic-key')
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists Venice profiles using a legacy-compatible openai startup profile', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const veniceProfile = buildVeniceProfile({
        id: 'venice_prof',
        model: 'venice-uncensored, venice-coding',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [veniceProfile],
      }))

      const result = setActiveProviderProfile('venice_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('venice_prof')
      expect(existsSync(join(tempDir, '.openclaude-profile.json'))).toBe(false)
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'https://api.venice.ai/api/v1',
        OPENAI_MODEL: 'venice-uncensored',
        OPENAI_API_KEY: 'venice-test-key',
        VENICE_API_KEY: 'venice-test-key',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists Fireworks AI profiles using a legacy-compatible openai startup profile', async () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), 'openclaude-provider-'),
    )
    const configDir = mkdtempSync(
      join(tmpdir(), 'openclaude-provider-config-'),
    )
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const fireworksProfile = buildFireworksProfile({
        id: 'fireworks_prof',
        model: 'accounts/fireworks/models/deepseek-v3, accounts/fireworks/models/llama-v3p1-70b-instruct',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [fireworksProfile],
      }))

      const result = setActiveProviderProfile('fireworks_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(
          join(configDir, '.openclaude-profile.json'),
          'utf8',
        ),
      )

      expect(result?.id).toBe('fireworks_prof')
      expect(
        existsSync(join(tempDir, '.openclaude-profile.json')),
      ).toBe(false)
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'https://api.fireworks.ai/inference/v1',
        OPENAI_MODEL: 'accounts/fireworks/models/deepseek-v3',
        OPENAI_API_KEY: 'fireworks-test-key',
        FIREWORKS_API_KEY: 'fireworks-test-key',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists Xiaomi MiMo profiles using a legacy-compatible openai startup profile', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const mimoProfile = buildXiaomiMimoProfile({
        baseUrl: 'https://api.mimo-v2.com/v1',
        id: 'mimo_prof',
        model: 'mimo-v2.5-pro, mimo-v2-flash',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [mimoProfile],
      }))

      const result = setActiveProviderProfile('mimo_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('mimo_prof')
      expect(existsSync(join(tempDir, '.openclaude-profile.json'))).toBe(false)
      expect(persisted.profile).toBe('openai')
      expect(persisted.env).toEqual({
        OPENAI_BASE_URL: 'https://api.xiaomimimo.com/v1',
        OPENAI_MODEL: 'mimo-v2.5-pro',
        OPENAI_API_KEY: 'mimo-test-key',
        MIMO_API_KEY: 'mimo-test-key',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists bedrock profiles using a dedicated startup profile kind', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const bedrockProfile = buildProfile({
        id: 'bedrock_prof',
        name: 'Bedrock',
        provider: 'bedrock',
        baseUrl: 'https://bedrock-proxy.example',
        model: 'claude-sonnet-4-6',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [bedrockProfile],
      }))

      const result = setActiveProviderProfile('bedrock_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('bedrock_prof')
      expect(existsSync(join(tempDir, '.openclaude-profile.json'))).toBe(false)
      expect(persisted.profile).toBe('bedrock')
      expect(persisted.env).toEqual({
        ANTHROPIC_MODEL: 'claude-sonnet-4-6',
        ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock-proxy.example',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('persists anthropic profiles using a dedicated anthropic startup profile', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))
    const configDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
    process.chdir(tempDir)
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      const { setActiveProviderProfile } =
        await importFreshProviderProfileModules()
      const anthropicProfile = buildProfile({
        id: 'anthro_persisted_prof',
        name: 'Anthropic Provider',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-live',
      })

      saveMockGlobalConfig(current => ({
        ...current,
        providerProfiles: [anthropicProfile],
      }))

      const result = setActiveProviderProfile('anthro_persisted_prof', {
        configDir,
      })
      const persisted = JSON.parse(
        readFileSync(join(configDir, '.openclaude-profile.json'), 'utf8'),
      )

      expect(result?.id).toBe('anthro_persisted_prof')
      expect(existsSync(join(tempDir, '.openclaude-profile.json'))).toBe(false)
      expect(persisted.profile).toBe('anthropic')
      expect(persisted.env).toEqual({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_MODEL: 'claude-sonnet-4-6',
        ANTHROPIC_API_KEY: 'sk-ant-live',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
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

    const result = setActiveProviderProfile('anthro_prof', {
      configDir: testConfigDir ?? undefined,
    })

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
    setActiveProviderProfile('openai_prof', {
      configDir: testConfigDir ?? undefined,
    })
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')

    // Now switch to the anthropic profile
    const result = setActiveProviderProfile('anthro_prof', {
      configDir: testConfigDir ?? undefined,
    })

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
    setActiveProviderProfile('anthro_prof', {
      configDir: testConfigDir ?? undefined,
    })
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')

    // Now switch to the openai profile
    const result = setActiveProviderProfile('openai_prof', {
      configDir: testConfigDir ?? undefined,
    })

    expect(result?.id).toBe('openai_prof')
    expect(String(process.env.CLAUDE_CODE_USE_OPENAI)).toBe('1')
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
    expect(process.env.ANTHROPIC_MODEL).toBeUndefined()
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

    const result = setActiveProviderProfile('nonexistent_prof', {
      configDir: testConfigDir ?? undefined,
    })

    expect(result).toBeNull()
  })
})

describe('deleteProviderProfile', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_MISTRAL
    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_FORMAT
  })

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
  test('getConfiguredProfileModelOptions ignores discovered cache entries', async () => {
    const { getConfiguredProfileModelOptions } =
      await importFreshProviderProfileModules()
    const profile = buildProfile({
      id: 'multi_provider',
      name: 'Multi Provider',
      model: 'glm-4.7, glm-4.7-flash',
    })

    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [profile],
      activeProviderProfileId: 'multi_provider',
      openaiAdditionalModelOptionsCacheByProfile: {
        multi_provider: [
          {
            value: 'glm-4.7-plus',
            label: 'glm-4.7-plus',
            description: 'Discovered from API',
          },
        ],
      },
    }

    expect(getConfiguredProfileModelOptions(profile)).toEqual([
      {
        value: 'glm-4.7',
        label: 'glm-4.7',
        description: 'Provider: Multi Provider',
      },
      {
        value: 'glm-4.7-flash',
        label: 'glm-4.7-flash',
        description: 'Provider: Multi Provider',
      },
    ])
  })

  test('route-scoped OpenAI cache ignores active profile cache entries', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:7777/v1'
    process.env.OPENAI_MODEL = 'route-model'

    const { getAdditionalModelOptionsCacheScope } = await import(
      '../services/api/providerConfig.js'
    )
    const { getActiveOpenAIRouteModelOptionsCache } =
      await importFreshProviderProfileModules()
    const profile = buildProfile({
      id: 'multi_provider',
      name: 'Multi Provider',
      baseUrl: 'http://localhost:7777/v1',
      model: 'profile-model',
    })

    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [profile],
      activeProviderProfileId: 'multi_provider',
      additionalModelOptionsCache: [
        {
          value: 'route-model',
          label: 'Route Model',
          description: 'Detected from route',
        },
      ],
      additionalModelOptionsCacheScope:
        getAdditionalModelOptionsCacheScope() ?? undefined,
      openaiAdditionalModelOptionsCacheByProfile: {
        multi_provider: [
          {
            value: 'profile-model',
            label: 'profile-model',
            description: 'Provider: Multi Provider',
          },
        ],
      },
    }

    expect(getActiveOpenAIRouteModelOptionsCache()).toEqual([
      {
        value: 'route-model',
        label: 'Route Model',
        description: 'Detected from route',
      },
    ])
  })

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

  test('appends discovered model cache entries for the same profile without duplicates', async () => {
    const { getProfileModelOptions } =
      await importFreshProviderProfileModules()

    mockConfigState = {
      ...createMockConfigState(),
      openaiAdditionalModelOptionsCacheByProfile: {
        provider_test: [
          {
            value: 'glm-4.7-flash',
            label: 'glm-4.7-flash',
            description: 'Discovered from API',
          },
          {
            value: 'glm-4.7-plus',
            label: 'glm-4.7-plus',
            description: 'Discovered from API',
          },
        ],
      },
    }

    const options = getProfileModelOptions(
      buildProfile({
        id: 'provider_test',
        name: 'Test Provider',
        model: 'glm-4.7, glm-4.7-flash',
      }),
    )

    expect(options).toEqual([
      { value: 'glm-4.7', label: 'glm-4.7', description: 'Provider: Test Provider' },
      { value: 'glm-4.7-flash', label: 'glm-4.7-flash', description: 'Provider: Test Provider' },
      { value: 'glm-4.7-plus', label: 'glm-4.7-plus', description: 'Discovered from API' },
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

    setActiveProviderProfile('multi_provider', {
      configDir: testConfigDir ?? undefined,
    })

    const cache = getActiveOpenAIModelOptionsCache()
    const cacheValues = cache.map((opt: { value: string }) => opt.value)
    expect(cacheValues).toContain('glm-4.7')
    expect(cacheValues).toContain('glm-4.7-flash')
    expect(cacheValues).toContain('glm-4.7-plus')
  })

  test('merges configured profile models with discovered cache on activation', async () => {
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
          model: 'glm-4.7, glm-4.7-flash',
          baseUrl: 'https://api.example.com/v1',
        }),
      ],
      openaiAdditionalModelOptionsCacheByProfile: {
        multi_provider: [
          {
            value: 'glm-4.7-plus',
            label: 'glm-4.7-plus',
            description: 'Discovered from API',
          },
          {
            value: 'glm-4.7-flash',
            label: 'glm-4.7-flash',
            description: 'Discovered from API',
          },
        ],
      },
    }

    setActiveProviderProfile('multi_provider', {
      configDir: testConfigDir ?? undefined,
    })

    expect(getActiveOpenAIModelOptionsCache()).toEqual([
      {
        value: 'glm-4.7',
        label: 'glm-4.7',
        description: 'Provider: Multi Provider',
      },
      {
        value: 'glm-4.7-flash',
        label: 'glm-4.7-flash',
        description: 'Provider: Multi Provider',
      },
      {
        value: 'glm-4.7-plus',
        label: 'glm-4.7-plus',
        description: 'Discovered from API',
      },
    ])
  })

  test('merges configured profile models with discovered cache during refresh writes', async () => {
    const {
      setActiveOpenAIModelOptionsCache,
      getActiveOpenAIModelOptionsCache,
    } = await importFreshProviderProfileModules()

    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [
        buildProfile({
          id: 'multi_provider',
          name: 'Multi Provider',
          model: 'glm-4.7, glm-4.7-flash',
          baseUrl: 'https://api.example.com/v1',
        }),
      ],
      activeProviderProfileId: 'multi_provider',
    }

    setActiveOpenAIModelOptionsCache([
      {
        value: 'glm-4.7-plus',
        label: 'glm-4.7-plus',
        description: 'Discovered from API',
      },
      {
        value: 'glm-4.7-flash',
        label: 'glm-4.7-flash',
        description: 'Discovered from API',
      },
    ])

    expect(getActiveOpenAIModelOptionsCache()).toEqual([
      {
        value: 'glm-4.7',
        label: 'glm-4.7',
        description: 'Provider: Multi Provider',
      },
      {
        value: 'glm-4.7-flash',
        label: 'glm-4.7-flash',
        description: 'Provider: Multi Provider',
      },
      {
        value: 'glm-4.7-plus',
        label: 'glm-4.7-plus',
        description: 'Discovered from API',
      },
    ])
  })

  test('falls back to configured profile models when no discovery cache exists yet', async () => {
    const {
      getActiveOpenAIModelOptionsCache,
    } = await importFreshProviderProfileModules()

    mockConfigState = {
      ...createMockConfigState(),
      providerProfiles: [
        buildProfile({
          id: 'multi_provider',
          name: 'Multi Provider',
          model: 'glm-4.7, glm-4.7-flash',
          baseUrl: 'https://api.example.com/v1',
        }),
      ],
      activeProviderProfileId: 'multi_provider',
    }

    expect(getActiveOpenAIModelOptionsCache()).toEqual([
      {
        value: 'glm-4.7',
        label: 'glm-4.7',
        description: 'Provider: Multi Provider',
      },
      {
        value: 'glm-4.7-flash',
        label: 'glm-4.7-flash',
        description: 'Provider: Multi Provider',
      },
    ])
  })
})

test('DEFAULT_MISTRAL_MODEL matches the mistral gateway defaultModel', async () => {
  const { DEFAULT_MISTRAL_MODEL } = await import('./providerProfile.js')
  const { default: mistralGateway } = await import('../integrations/gateways/mistral.js')
  expect(mistralGateway.defaultModel).toBeDefined()
  expect(DEFAULT_MISTRAL_MODEL).toBe(mistralGateway.defaultModel!)
})

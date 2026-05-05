import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

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
  'HICAP_API_KEY',
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

beforeEach(() => {
  for (const key of RESTORED_KEYS) {
    delete process.env[key]
  }
  testConfigDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-config-'))
  process.env.CLAUDE_CONFIG_DIR = testConfigDir
})

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
  if (testConfigDir) {
    rmSync(testConfigDir, { recursive: true, force: true })
    testConfigDir = null
  }
})

async function importFreshProviderProfileModules() {
  mock.restore()
  const actualConfig = await import(`./config.js?ts=${Date.now()}-${Math.random()}`)
  mock.module('./config.js', () => ({
    ...actualConfig,
    getGlobalConfig: () => mockConfigState,
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
        baseUrl: 'https://api.minimax.io/v1',
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

    expect(process.env.OPENAI_BASE_URL).toBe('https://api.minimax.io/v1')
    expect(process.env.OPENAI_MODEL).toBe('MiniMax-M2.7')
    expect(process.env.OPENAI_API_KEY).toBe('minimax-live-key')
    expect(process.env.MINIMAX_API_KEY).toBe('minimax-live-key')
    expect(process.env.OPENAI_API_FORMAT).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
    expect(process.env.OPENAI_AUTH_SCHEME).toBeUndefined()
    expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
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

  test('minimax preset defaults to MiniMax M2.7', async () => {
    const { getProviderPresetDefaults } = await importFreshProviderProfileModules()

    const defaults = getProviderPresetDefaults('minimax')

    expect(defaults.provider).toBe('minimax')
    expect(defaults.name).toBe('MiniMax')
    expect(defaults.baseUrl).toBe('https://api.minimax.io/v1')
    expect(defaults.model).toBe('MiniMax-M2.7')
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

      const result = setActiveProviderProfile('openai_prof')

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

      const result = setActiveProviderProfile('ollama_prof')
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

      const result = setActiveProviderProfile('deepseek_prof')
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

      const result = setActiveProviderProfile('deepseek_vendor_prof')
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

      const result = setActiveProviderProfile('bedrock_prof')
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

      const result = setActiveProviderProfile('anthro_persisted_prof')
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

    setActiveProviderProfile('multi_provider')

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

    setActiveProviderProfile('multi_provider')

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

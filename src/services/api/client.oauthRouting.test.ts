import { afterEach, expect, mock, test } from 'bun:test'

const originalMacro = (globalThis as Record<string, unknown>).MACRO
const originalEnv = {
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
}

type AuthMockOptions = {
  refreshSpy: ReturnType<typeof mock>
  isClaudeAISubscriber?: boolean
}

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
}

function installAuthMock({
  refreshSpy,
  isClaudeAISubscriber = true,
}: AuthMockOptions): void {
  mock.module('src/utils/auth.js', () => ({
    checkAndRefreshOAuthTokenIfNeeded: refreshSpy,
    clearApiKeyHelperCache: () => {},
    clearAwsCredentialsCache: () => {},
    clearGcpCredentialsCache: () => {},
    clearOAuthTokenCache: () => {},
    getAccountInformation: () => null,
    getAnthropicApiKey: () => undefined,
    getApiKeyFromApiKeyHelper: async () => undefined,
    getApiKeyFromApiKeyHelperCached: () => null,
    getApiKeyFromConfigOrMacOSKeychain: () => null,
    getApiKeyHelperElapsedMs: () => 0,
    getClaudeAIOAuthTokens: () => ({
      accessToken: 'stored-claude-oauth-token',
      refreshToken: 'stored-claude-refresh-token',
      expiresAt: Date.now() + 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'pro',
      rateLimitTier: null,
    }),
    getAuthTokenSource: () => ({ source: 'none', hasToken: false }),
    getAnthropicApiKeyWithSource: () => ({ apiKey: undefined, source: 'none' }),
    getOauthAccountInfo: () => null,
    getRateLimitTier: () => null,
    getSubscriptionName: () => 'Claude Pro',
    getSubscriptionType: () => 'pro',
    hasAnthropicApiKeyAuth: () => false,
    hasOpusAccess: () => false,
    hasProfileScope: () => false,
    handleOAuth401Error: async () => false,
    is1PApiCustomer: () => false,
    isAnthropicAuthEnabled: () => true,
    isClaudeAISubscriber: () => isClaudeAISubscriber,
    isConsumerSubscriber: () => true,
    isCustomApiKeyApproved: () => true,
    isEnterpriseSubscriber: () => false,
    isMaxSubscriber: () => false,
    isOverageProvisioningAllowed: () => false,
    isProSubscriber: () => true,
    isTeamSubscriber: () => false,
    isUsing3PServices: () => false,
    isTeamPremiumSubscriber: () => false,
    prefetchApiKeyFromApiKeyHelperIfSafe: () => {},
    prefetchAwsCredentialsAndBedRockInfoIfSafe: () => {},
    prefetchGcpCredentialsIfSafe: () => {},
    refreshAndGetAwsCredentials: async () => null,
    refreshGcpCredentialsIfNeeded: async () => {},
    removeApiKey: async () => {},
    saveApiKey: async () => {},
    saveOAuthTokensIfNeeded: () => ({ success: true }),
    validateForceLoginOrg: async () => ({ valid: true }),
  }))
}

async function importFreshClientModule() {
  return import(`./client.ts?ts=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    restoreEnv(key)
  }
  mock.restore()
})

test('Gemini provider creation does not refresh stored Claude OAuth tokens', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = { VERSION: 'test-version' }
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_API_KEY = 'gemini-test-key'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash'
  process.env.GEMINI_BASE_URL = 'https://gemini.example/v1beta/openai'
  process.env.GEMINI_AUTH_MODE = 'api-key'

  const refreshSpy = mock(async () => false)
  installAuthMock({ refreshSpy })

  const { getAnthropicClient } = await importFreshClientModule()

  await getAnthropicClient({
    maxRetries: 0,
    model: 'gemini-2.0-flash',
  })

  expect(refreshSpy).toHaveBeenCalledTimes(0)
})

test('providerOverride creation does not refresh stored Claude OAuth tokens', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = { VERSION: 'test-version' }
  clearProviderEnv()

  const refreshSpy = mock(async () => false)
  installAuthMock({ refreshSpy })

  const { getAnthropicClient } = await importFreshClientModule()

  await getAnthropicClient({
    maxRetries: 0,
    providerOverride: {
      model: 'gpt-4o',
      baseURL: 'https://provider.example/v1',
      apiKey: 'provider-test-key',
    },
  })

  expect(refreshSpy).toHaveBeenCalledTimes(0)
})

test('first-party Anthropic client creation still refreshes stored Claude OAuth tokens', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = { VERSION: 'test-version' }
  clearProviderEnv()

  const refreshSpy = mock(async () => false)
  installAuthMock({ refreshSpy })

  const { getAnthropicClient } = await importFreshClientModule()

  await getAnthropicClient({
    maxRetries: 0,
    model: 'claude-sonnet-4-5',
  })

  expect(refreshSpy).toHaveBeenCalledTimes(1)
})

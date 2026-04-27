import { afterEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }

async function importFreshFastModeModule() {
  return import(`./fastMode.ts?ts=${Date.now()}-${Math.random()}`)
}

function installCommonMocks(options?: {
  cachedEnabled?: boolean
  apiKey?: string | null
  oauthToken?: string | null
  hasProfileScope?: boolean
  axiosReject?: boolean
}) {
  mock.module('axios', () => ({
    default: {
      get: options?.axiosReject
        ? async () => {
            throw new Error('network fail')
          }
        : async () => ({ data: { enabled: false, disabled_reason: 'preference' } }),
      isAxiosError: () => false,
    },
  }))

  mock.module('src/constants/oauth.js', () => ({
    fileSuffixForOauthConfig: () => '',
    CLAUDE_AI_INFERENCE_SCOPE: 'user:inference',
    CLAUDE_AI_PROFILE_SCOPE: 'user:profile',
    OAUTH_BETA_HEADER: 'test-beta',
    CONSOLE_OAUTH_SCOPES: ['org:create_api_key', 'user:profile'],
    CLAUDE_AI_OAUTH_SCOPES: ['user:profile', 'user:inference'],
    ALL_OAUTH_SCOPES: ['org:create_api_key', 'user:profile', 'user:inference'],
    MCP_CLIENT_METADATA_URL: 'https://claude.ai/oauth/claude-code-client-metadata',
    getOauthConfig: () => ({
      BASE_API_URL: 'https://api.anthropic.com',
      CONSOLE_AUTHORIZE_URL: 'https://platform.claude.com/oauth/authorize',
      CLAUDE_AI_AUTHORIZE_URL: 'https://claude.com/cai/oauth/authorize',
      CLAUDE_AI_ORIGIN: 'https://claude.ai',
      TOKEN_URL: 'https://platform.claude.com/v1/oauth/token',
      API_KEY_URL: 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
      ROLES_URL: 'https://api.anthropic.com/api/oauth/claude_cli/roles',
      CONSOLE_SUCCESS_URL: 'https://platform.claude.com/oauth/code/success',
      CLAUDEAI_SUCCESS_URL: 'https://platform.claude.com/oauth/code/success',
      MANUAL_REDIRECT_URL: 'https://platform.claude.com/oauth/code/callback',
      CLIENT_ID: 'test-client-id',
      OAUTH_FILE_SUFFIX: '',
      MCP_PROXY_URL: 'https://mcp-proxy.anthropic.com',
      MCP_PROXY_PATH: '/v1/mcp/{server_id}',
    }),
  }))

  mock.module('../services/analytics/index.js', () => ({
    logEvent: () => {},
  }))

  mock.module('./auth.js', () => ({
    isAnthropicAuthEnabled: () => true,
    getAuthTokenSource: () => 'none',
    getAnthropicApiKey: () => options?.apiKey ?? null,
    hasAnthropicApiKeyAuth: () => Boolean(options?.apiKey),
    getAnthropicApiKeyWithSource: () => ({
      apiKey: options?.apiKey ?? null,
      source: options?.apiKey ? 'env' : null,
    }),
    getConfiguredApiKeyHelper: () => undefined,
    isAwsAuthRefreshFromProjectSettings: () => false,
    isAwsCredentialExportFromProjectSettings: () => false,
    calculateApiKeyHelperTTL: () => 0,
    getApiKeyHelperElapsedMs: () => 0,
    getApiKeyFromApiKeyHelper: async () => null,
    getApiKeyFromApiKeyHelperCached: () => null,
    clearApiKeyHelperCache: () => {},
    prefetchApiKeyFromApiKeyHelperIfSafe: () => {},
    refreshAwsAuth: async () => false,
    refreshAndGetAwsCredentials: async () => null,
    clearAwsCredentialsCache: () => {},
    isGcpAuthRefreshFromProjectSettings: () => false,
    checkGcpCredentialsValid: async () => false,
    refreshGcpAuth: async () => false,
    refreshGcpCredentialsIfNeeded: async () => false,
    clearGcpCredentialsCache: () => {},
    prefetchGcpCredentialsIfSafe: () => {},
    prefetchAwsCredentialsAndBedRockInfoIfSafe: () => {},
    getApiKeyFromConfigOrMacOSKeychain: () => null,
    saveApiKey: async () => {},
    isCustomApiKeyApproved: () => false,
    removeApiKey: async () => {},
    saveOAuthTokensIfNeeded: () => ({ didSave: false }),
    getClaudeAIOAuthTokens: () =>
      options?.oauthToken ? { accessToken: options.oauthToken } : null,
    clearOAuthTokenCache: () => {},
    handleOAuth401Error: async () => {},
    getClaudeAIOAuthTokensAsync: async () =>
      options?.oauthToken ? { accessToken: options.oauthToken } : null,
    checkAndRefreshOAuthTokenIfNeeded: async () => null,
    isClaudeAISubscriber: () => Boolean(options?.oauthToken),
    hasProfileScope: () => options?.hasProfileScope ?? false,
    is1PApiCustomer: () => Boolean(options?.apiKey),
    getOauthAccountInfo: () => undefined,
    isOverageProvisioningAllowed: () => false,
    hasOpusAccess: () => false,
    getSubscriptionType: () => null,
    isMaxSubscriber: () => false,
    isTeamSubscriber: () => false,
    isTeamPremiumSubscriber: () => false,
    isEnterpriseSubscriber: () => false,
    isProSubscriber: () => false,
    getRateLimitTier: () => null,
    getSubscriptionName: () => '',
    isUsing3PServices: () => false,
    isOtelHeadersHelperFromProjectOrLocalSettings: () => false,
    getOtelHeadersFromHelper: () => ({}),
    isConsumerSubscriber: () => false,
    getAccountInformation: () => undefined,
    validateForceLoginOrg: async () => ({ ok: true }),
  }))

  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => 'firstParty',
    usesAnthropicAccountFlow: () => true,
    isGithubNativeAnthropicMode: () => false,
    getAPIProviderForStatsig: () => 'firstParty',
    isFirstPartyAnthropicBaseUrl: () => true,
  }))

  mock.module('./signal.js', () => ({
    createSignal: () => {
      const subscribe = () => () => {}
      const emit = () => {}
      return { subscribe, emit }
    },
  }))
}

async function prepareRealState(options?: { cachedEnabled?: boolean }) {
  const { setIsInteractive } = await import('../bootstrap/state.js')
  setIsInteractive(true)

  const { DEFAULT_GLOBAL_CONFIG, _setGlobalConfigCacheForTesting } =
    await import('./config.js')
  _setGlobalConfigCacheForTesting({
    ...DEFAULT_GLOBAL_CONFIG,
    penguinModeOrgEnabled: options?.cachedEnabled === true,
  })
}

afterEach(async () => {
  mock.restore()
  process.env = { ...originalEnv }
  const { resetStateForTests } = await import('../bootstrap/state.js')
  resetStateForTests()
  const { _setGlobalConfigCacheForTesting } = await import('./config.js')
  _setGlobalConfigCacheForTesting(null)
})

describe('fastMode ant-only fallback cleanup', () => {
  test('resolveFastModeStatusFromCache does not force-enable from USER_TYPE=ant', async () => {
    process.env.USER_TYPE = 'ant'
    await prepareRealState({ cachedEnabled: false })
    installCommonMocks({ cachedEnabled: false })

    const {
      resolveFastModeStatusFromCache,
      getFastModeUnavailableReason,
    } = await importFreshFastModeModule()

    resolveFastModeStatusFromCache()

    expect(getFastModeUnavailableReason()).toBe(
      'Fast mode is currently unavailable',
    )
  })

  test('prefetchFastModeStatus without auth does not force-enable from USER_TYPE=ant', async () => {
    process.env.USER_TYPE = 'ant'
    await prepareRealState({ cachedEnabled: false })
    installCommonMocks({ cachedEnabled: false, apiKey: null, oauthToken: null })

    const {
      prefetchFastModeStatus,
      getFastModeUnavailableReason,
    } = await importFreshFastModeModule()

    await prefetchFastModeStatus()

    expect(getFastModeUnavailableReason()).toBe(
      'Fast mode has been disabled by your organization',
    )
  })

  test('prefetchFastModeStatus network failure does not force-enable from USER_TYPE=ant', async () => {
    process.env.USER_TYPE = 'ant'
    await prepareRealState({ cachedEnabled: false })
    installCommonMocks({
      cachedEnabled: false,
      apiKey: 'test-key',
      axiosReject: true,
    })

    const {
      prefetchFastModeStatus,
      getFastModeUnavailableReason,
    } = await importFreshFastModeModule()

    await prefetchFastModeStatus()

    expect(getFastModeUnavailableReason()).toBe(
      'Fast mode unavailable due to network connectivity issues',
    )
  })
})

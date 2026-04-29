import { afterEach, expect, mock, test } from 'bun:test'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

const originalEnv = {
  CLAUDE_CODE_ACCOUNT_UUID: process.env.CLAUDE_CODE_ACCOUNT_UUID,
  CLAUDE_CODE_USER_EMAIL: process.env.CLAUDE_CODE_USER_EMAIL,
  CLAUDE_CODE_ORGANIZATION_UUID: process.env.CLAUDE_CODE_ORGANIZATION_UUID,
}

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function installPopulateAccountInfoMocks({
  isClaudeAISubscriber,
  refreshSpy,
  profileSpy,
}: {
  isClaudeAISubscriber: boolean
  refreshSpy: ReturnType<typeof mock>
  profileSpy: ReturnType<typeof mock>
}): void {
  mock.module('../../utils/auth.js', () => ({
    checkAndRefreshOAuthTokenIfNeeded: refreshSpy,
    clearApiKeyHelperCache: () => {},
    clearAwsCredentialsCache: () => {},
    clearGcpCredentialsCache: () => {},
    clearOAuthTokenCache: () => {},
    getAccountInformation: () => null,
    getAnthropicApiKey: () => undefined,
    getAnthropicApiKeyWithSource: () => ({
      apiKey: undefined,
      key: undefined,
      source: 'none',
    }),
    getApiKeyFromApiKeyHelper: async () => undefined,
    getApiKeyFromApiKeyHelperCached: () => null,
    getApiKeyFromConfigOrMacOSKeychain: () => null,
    getApiKeyHelperElapsedMs: () => 0,
    getAuthTokenSource: () => ({ source: 'none', hasToken: false }),
    getClaudeAIOAuthTokens: () => ({
      accessToken: 'stored-claude-oauth-token',
      refreshToken: 'stored-claude-refresh-token',
      expiresAt: Date.now() + 60_000,
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: 'pro',
      rateLimitTier: null,
    }),
    getOauthAccountInfo: () => null,
    getRateLimitTier: () => null,
    getSubscriptionName: () => 'Claude Pro',
    getSubscriptionType: () => 'pro',
    handleOAuth401Error: async () => false,
    hasAnthropicApiKeyAuth: () => false,
    hasProfileScope: () => true,
    hasOpusAccess: () => false,
    is1PApiCustomer: () => false,
    isAnthropicAuthEnabled: () => isClaudeAISubscriber,
    isClaudeAISubscriber: () => isClaudeAISubscriber,
    isConsumerSubscriber: () => true,
    isCustomApiKeyApproved: () => true,
    isEnterpriseSubscriber: () => false,
    isMaxSubscriber: () => false,
    isOverageProvisioningAllowed: () => false,
    isProSubscriber: () => true,
    isTeamPremiumSubscriber: () => false,
    isTeamSubscriber: () => false,
    isUsing3PServices: () => false,
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

  mock.module('./getOauthProfile.js', () => ({
    getOauthProfileFromOauthToken: profileSpy,
  }))
}

async function importFreshOAuthClientModule() {
  return import(`./client.ts?ts=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    restoreEnv(key)
  }
  saveGlobalConfig(current => ({ ...current, oauthAccount: undefined }))
  mock.restore()
})

test('OAuth account info population does not refresh when Claude.ai auth is inactive', async () => {
  delete process.env.CLAUDE_CODE_ACCOUNT_UUID
  delete process.env.CLAUDE_CODE_USER_EMAIL
  delete process.env.CLAUDE_CODE_ORGANIZATION_UUID
  saveGlobalConfig(current => ({ ...current, oauthAccount: undefined }))

  const refreshSpy = mock(async () => false)
  const profileSpy = mock(async () => null)
  installPopulateAccountInfoMocks({
    isClaudeAISubscriber: false,
    refreshSpy,
    profileSpy,
  })

  const { populateOAuthAccountInfoIfNeeded } = await importFreshOAuthClientModule()
  mock.restore()

  const populated = await populateOAuthAccountInfoIfNeeded()

  expect(populated).toBe(false)
  expect(refreshSpy).toHaveBeenCalledTimes(0)
  expect(profileSpy).toHaveBeenCalledTimes(0)
})

test('OAuth account info population still refreshes active Claude.ai auth', async () => {
  delete process.env.CLAUDE_CODE_ACCOUNT_UUID
  delete process.env.CLAUDE_CODE_USER_EMAIL
  delete process.env.CLAUDE_CODE_ORGANIZATION_UUID
  saveGlobalConfig(current => ({ ...current, oauthAccount: undefined }))

  const refreshSpy = mock(async () => true)
  const profileSpy = mock(async () => ({
    account: {
      uuid: 'account-uuid',
      email: 'user@example.com',
      display_name: 'Test User',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    organization: {
      uuid: 'org-uuid',
      has_extra_usage_enabled: true,
      billing_type: 'claude_pro',
      subscription_created_at: '2026-01-02T00:00:00.000Z',
    },
  }))
  installPopulateAccountInfoMocks({
    isClaudeAISubscriber: true,
    refreshSpy,
    profileSpy,
  })

  const { populateOAuthAccountInfoIfNeeded } = await importFreshOAuthClientModule()
  mock.restore()

  const populated = await populateOAuthAccountInfoIfNeeded()

  expect(populated).toBe(true)
  expect(refreshSpy).toHaveBeenCalledTimes(1)
  expect(profileSpy).toHaveBeenCalledWith('stored-claude-oauth-token')
  expect(getGlobalConfig().oauthAccount).toEqual({
    accountUuid: 'account-uuid',
    emailAddress: 'user@example.com',
    organizationUuid: 'org-uuid',
    displayName: 'Test User',
    hasExtraUsageEnabled: true,
    billingType: 'claude_pro',
    accountCreatedAt: '2026-01-01T00:00:00.000Z',
    subscriptionCreatedAt: '2026-01-02T00:00:00.000Z',
  })
})

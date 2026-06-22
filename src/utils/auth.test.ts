import { afterEach, expect, mock, test } from 'bun:test'
import * as originalSettings from './settings/settings.js'

async function importAuthFresh() {
  return await import(`./auth.js?ts=${Date.now()}-${Math.random()}`)
}

// Restore Bun's module mocks after each test so leaked settings behavior
// cannot influence later auth/settings tests in the same process.
// Addresses jatmn's P3 on #1731: test isolation for mock.module().
afterEach(() => {
  mock.restore()
})

// Helper: mock settings to return the given subscriptionType from a specific
// source (or no source at all). The trusted-source helper in auth.ts reads
// from policy/flag/user/local only — project and repository settings must
// NOT propagate subscriptionType.
function mockSettings(
  subscriptionType: string | undefined,
  source: 'trusted' | 'project' | 'none' = 'trusted',
) {
  mock.module('./settings/settings.js', () => ({
    ...originalSettings,
    getSettings_DEPRECATED: () =>
      source === 'project'
        ? { subscriptionType } // simulates merged view including project
        : source === 'trusted'
          ? { subscriptionType }
          : {},
    getSettingsForSource: (s: string) => {
      if (source === 'none') return undefined
      if (source === 'project') {
        // projectSettings/repoSettings are untrusted and must be ignored
        return s === 'projectSettings' || s === 'repositorySettings'
          ? { subscriptionType }
          : undefined
      }
      // trusted: only user/local/flag/policy carry the override
      const trusted = new Set([
        'userSettings',
        'localSettings',
        'flagSettings',
        'policySettings',
      ])
      return trusted.has(s) ? { subscriptionType } : undefined
    },
  }))
}

test('isClaudeAISubscriber returns true if subscriptionType is pro in trusted settings', async () => {
  mockSettings('pro', 'trusted')
  const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
  expect(isClaudeAISubscriber()).toBe(true)
  expect(getSubscriptionType()).toBe('pro')
})

test('isClaudeAISubscriber returns false if subscriptionType is free in trusted settings', async () => {
  mockSettings('free', 'trusted')
  const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
  expect(isClaudeAISubscriber()).toBe(false)
  expect(getSubscriptionType()).toBe('free')
})

// P2 regression: subscriptionType: "free" must short-circuit the OAuth path.
// Prior code only short-circuited non-free values, so free + valid OAuth
// returned true (the OAuth-detected subscriber state leaked through). This
// test sets a fake Claude AI OAuth token that WOULD satisfy the OAuth path,
// then asserts the free override wins.
test('isClaudeAISubscriber returns false for free override even when OAuth tokens would qualify', async () => {
  mockSettings('free', 'trusted')
  // Plant a fake token so isAnthropicAuthEnabled() / shouldUseClaudeAIAuth()
  // would return true without the override. The override must win.
  const previousTokens = process.env.CLAUDE_AI_OAUTH_TOKEN
  process.env.CLAUDE_AI_OAUTH_TOKEN = JSON.stringify({
    accessToken: 'test',
    refreshToken: 'test',
    expiresAt: Date.now() + 60_000,
    scopes: ['user:inference', 'user:profile'],
    subscriptionType: 'pro',
  })
  try {
    const { isClaudeAISubscriber } = await importAuthFresh()
    expect(isClaudeAISubscriber()).toBe(false)
  } finally {
    if (previousTokens === undefined) {
      delete process.env.CLAUDE_AI_OAUTH_TOKEN
    } else {
      process.env.CLAUDE_AI_OAUTH_TOKEN = previousTokens
    }
  }
})

// P1 regression: project settings must NOT be able to spoof subscriber state.
test('isClaudeAISubscriber ignores subscriptionType from projectSettings', async () => {
  mockSettings('pro', 'project')
  const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
  // With no OAuth path exercised in this test, the untrusted project value
  // must not be returned. We expect null (no override) rather than 'pro'.
  expect(getSubscriptionType()).toBe(null)
  // isClaudeAISubscriber falls through to the OAuth path; without OAuth
  // tokens set in the test env, it should return false rather than true.
  expect(isClaudeAISubscriber()).toBe(false)
})

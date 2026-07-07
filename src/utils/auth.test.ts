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
// from user settings only — project, local, flag, and policy settings must
// NOT propagate subscriptionType.
function mockSettings(
  subscriptionType: string | undefined,
  source: 'user' | 'project' | 'none' = 'user',
) {
  mock.module('./settings/settings.js', () => ({
    ...originalSettings,
    getSettings_DEPRECATED: () =>
      source === 'project'
        ? { subscriptionType } // simulates merged view including project
        : source === 'user'
          ? { subscriptionType }
          : {},
    getSettingsForSource: (s: string) => {
      if (source === 'none') return null
      if (source === 'project') {
        // projectSettings/repoSettings are untrusted and must be ignored
        return s === 'projectSettings' || s === 'repositorySettings'
          ? { subscriptionType }
          : null
      }
      // user settings only:
      return s === 'userSettings' ? { subscriptionType } : null
    },
  }))
}

async function withOAuthFallbackEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
    CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
    CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
    CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
    CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
    CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
    CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  }
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-token'
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('isClaudeAISubscriber returns true if subscriptionType is pro in user settings', async () => {
  mockSettings('pro', 'user')
  const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
  expect(isClaudeAISubscriber()).toBe(true)
  expect(getSubscriptionType()).toBe('pro')
})

test('isClaudeAISubscriber returns false if subscriptionType is free in user settings', async () => {
  mockSettings('free', 'user')
  const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
  expect(isClaudeAISubscriber()).toBe(false)
  expect(getSubscriptionType()).toBe('free')
})

test('isClaudeAISubscriber returns true for OAuth fallback without a free override', async () => {
  mockSettings(undefined, 'none')
  await withOAuthFallbackEnv(async () => {
    const { isClaudeAISubscriber } = await importAuthFresh()
    expect(isClaudeAISubscriber()).toBe(true)
  })
})

// P2 regression: subscriptionType: "free" must short-circuit the OAuth path.
// Prior code only short-circuited non-free values, so free + valid OAuth
// returned true (the OAuth-detected subscriber state leaked through). This
// test sets a fake Claude AI OAuth token that WOULD satisfy the OAuth path,
// then asserts the free override wins.
test('isClaudeAISubscriber returns false for free override even when OAuth tokens would qualify', async () => {
  mockSettings('free', 'user')
  await withOAuthFallbackEnv(async () => {
    const { isClaudeAISubscriber } = await importAuthFresh()
    expect(isClaudeAISubscriber()).toBe(false)
  })
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

// P2/P3 regression: when subscriptionType is 'free', isClaudeAISubscriber() returns false
// even if fallback auth conditions (OAuth/environment) are satisfied, and getSubscriptionType() returns 'free'.
test("when subscriptionType is 'free', isClaudeAISubscriber() returns false even if fallback auth conditions are satisfied, and getSubscriptionType() returns 'free'", async () => {
  mockSettings('free', 'user')
  await withOAuthFallbackEnv(async () => {
    const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
    expect(isClaudeAISubscriber()).toBe(false)
    expect(getSubscriptionType()).toBe('free')
  })
})

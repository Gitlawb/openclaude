import { afterEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }

async function importFreshUserModule() {
  return import(`./user.ts?ts=${Date.now()}-${Math.random()}`)
}

function installCommonMocks(options?: {
  oauthEmail?: string
  gitEmail?: string
}) {
  // NOTE: Do NOT mock ../bootstrap/state.js here.
  // mock.module() is process-global in bun:test and mock.restore() does NOT
  // undo it. Mocking state.js leaks getSessionId = () => 'session-test' into
  // every other test file that imports state.js (e.g. SDK CON-1 tests).
  // The dynamic import (importFreshUserModule) will use the real state.js,
  // which is fine — these tests only assert email, not sessionId.

  mock.module('./auth.js', () => ({
    getOauthAccountInfo: () =>
      options?.oauthEmail
        ? {
            emailAddress: options.oauthEmail,
            organizationUuid: 'org-test',
            accountUuid: 'acct-test',
          }
        : undefined,
    getRateLimitTier: () => null,
    getSubscriptionType: () => null,
  }))

  mock.module('./config.js', () => ({
    getGlobalConfig: () => ({}),
    getOrCreateUserID: () => 'device-test',
  }))

  mock.module('./cwd.js', () => ({
    getCwd: () => 'C:\\repo',
  }))

  mock.module('./env.js', () => ({
    env: { platform: 'windows' },
    getHostPlatformForAnalytics: () => 'windows',
  }))

  mock.module('./envUtils.js', () => ({
    isEnvTruthy: (value: string | undefined) =>
      !!value && value !== '0' && value.toLowerCase() !== 'false',
  }))

  mock.module('execa', () => ({
    execa: async () => ({
      exitCode: options?.gitEmail ? 0 : 1,
      stdout: options?.gitEmail ?? '',
    }),
  }))
}

afterEach(() => {
  mock.restore()
  process.env = { ...originalEnv }
  delete (globalThis as Record<string, unknown>).MACRO
})

describe('user email fallbacks', () => {
  test('getCoreUserData does not synthesize Anthropic email from COO_CREATOR', async () => {
    process.env.USER_TYPE = 'ant'
    process.env.COO_CREATOR = 'alice'
    ;(globalThis as Record<string, unknown>).MACRO = { VERSION: '0.0.0' }

    installCommonMocks()

    const { getCoreUserData } = await importFreshUserModule()
    const result = getCoreUserData()

    expect(result.email).toBeUndefined()
  })

  test('initUser falls back to git email when oauth email is missing', async () => {
    process.env.USER_TYPE = 'ant'
    process.env.COO_CREATOR = 'alice'
    ;(globalThis as Record<string, unknown>).MACRO = { VERSION: '0.0.0' }

    installCommonMocks({ gitEmail: 'git@example.com' })

    const { initUser, getCoreUserData } = await importFreshUserModule()
    await initUser()

    const result = getCoreUserData()
    expect(result.email).toBe('git@example.com')
  })
})

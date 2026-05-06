import { afterEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }

async function importFreshUserModule() {
  return import(`./user.ts?ts=${Date.now()}-${Math.random()}`)
}

async function importActualUserTestDeps() {
  const nonce = `${Date.now()}-${Math.random()}`
  const [authModule, configModule, cwdModule, execaModule] = await Promise.all([
    import(`./auth.js?ts=${nonce}`),
    import(`./config.js?ts=${nonce}`),
    import(`./cwd.js?ts=${nonce}`),
    import('execa'),
  ])

  return {
    authModule,
    configModule,
    cwdModule,
    execaModule,
  }
}

async function installCommonMocks(options?: {
  oauthEmail?: string
  gitEmail?: string
}) {
  // NOTE: Do NOT mock ../bootstrap/state.js here.
  // mock.module() is process-global in bun:test and mock.restore() does NOT
  // undo it. Mocking state.js leaks getSessionId = () => 'session-test' into
  // every other test file that imports state.js (e.g. SDK CON-1 tests).
  // The dynamic import (importFreshUserModule) will use the real state.js,
  // which is fine — these tests only assert email, not sessionId.
  const { authModule, configModule, cwdModule, execaModule } =
    await importActualUserTestDeps()

  mock.module('./auth.js', () => ({
    ...authModule,
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
    ...configModule,
    getGlobalConfig: () => ({}),
    getOrCreateUserID: () => 'device-test',
  }))

  mock.module('./cwd.js', () => ({
    ...cwdModule,
    getCwd: () => 'C:\\repo',
  }))

  mock.module('execa', () => ({
    ...execaModule,
    execa: async () => ({
      exitCode: options?.gitEmail ? 0 : 1,
      stdout: options?.gitEmail ?? '',
    }),
    execaSync: () => ({
      exitCode: 1,
      stdout: '',
      stderr: '',
      failed: true,
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

    await installCommonMocks()

    const { getCoreUserData } = await importFreshUserModule()
    const result = getCoreUserData()

    expect(result.email).toBeUndefined()
  })

  test('initUser falls back to git email when oauth email is missing', async () => {
    process.env.USER_TYPE = 'ant'
    process.env.COO_CREATOR = 'alice'
    ;(globalThis as Record<string, unknown>).MACRO = { VERSION: '0.0.0' }

    await installCommonMocks({ gitEmail: 'git@example.com' })

    const { initUser, getCoreUserData } = await importFreshUserModule()
    await initUser()

    const result = getCoreUserData()
    expect(result.email).toBe('git@example.com')
  })
})

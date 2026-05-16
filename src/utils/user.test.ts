import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realExeca from 'execa'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realAuth from './auth.js'
import * as realConfig from './config.js'
import * as realCwd from './cwd.js'
import * as realEnv from './env.js'
import * as realEnvUtils from './envUtils.js'

const originalEnv = { ...process.env }
const originalMacro = (globalThis as Record<string, unknown>).MACRO

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
    ...realAuth,
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
    ...realConfig,
    getGlobalConfig: () => ({}),
    getOrCreateUserID: () => 'device-test',
  }))

  mock.module('./cwd.js', () => ({
    ...realCwd,
    getCwd: () => 'C:\\repo',
  }))

  mock.module('./env.js', () => ({
    ...realEnv,
    env: { platform: 'windows' },
    getHostPlatformForAnalytics: () => 'windows',
  }))

  mock.module('./envUtils.js', () => ({
    ...realEnvUtils,
    isEnvTruthy: (value: string | undefined) =>
      !!value && value !== '0' && value.toLowerCase() !== 'false',
  }))

  mock.module('execa', () => ({
    ...realExeca,
    execa: async () => ({
      exitCode: options?.gitEmail ? 0 : 1,
      stdout: options?.gitEmail ?? '',
    }),
  }))
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/user.test.ts')
})

afterEach(() => {
  try {
    mock.restore()
    mock.module('./auth.js', () => realAuth)
    mock.module('./config.js', () => realConfig)
    mock.module('./cwd.js', () => realCwd)
    mock.module('./env.js', () => realEnv)
    mock.module('./envUtils.js', () => realEnvUtils)
    mock.module('execa', () => realExeca)
    process.env = { ...originalEnv }
    if (originalMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    }
  } finally {
    releaseSharedMutationLock()
  }
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

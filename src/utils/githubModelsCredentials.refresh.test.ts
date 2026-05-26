import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realDeviceFlow from '../services/github/deviceFlow.js'
import * as realSecureStorage from './secureStorage/index.js'

async function importFreshModule() {
  mock.restore()
  return import(`./githubModelsCredentials.ts?ts=${Date.now()}-${Math.random()}`)
}

describe('refreshGithubModelsTokenIfNeeded', () => {
  const orig = {
    CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
    CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
  }

  beforeEach(async () => {
    await acquireSharedMutationLock('utils/githubModelsCredentials.refresh.test.ts')
    mock.restore()
  })

  afterEach(() => {
    try {
      mock.restore()
      mock.module('./secureStorage/index.js', () => realSecureStorage)
      mock.module('../services/github/deviceFlow.js', () => realDeviceFlow)
      for (const [k, v] of Object.entries(orig)) {
        if (v === undefined) {
          delete process.env[k as keyof typeof orig]
        } else {
          process.env[k as keyof typeof orig] = v
        }
      }
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('refreshes expired Copilot token using stored OAuth token', async () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN

    const futureExp = Math.floor(Date.now() / 1000) + 3600
    let store: Record<string, unknown> = {
      githubModels: {
        accessToken: 'tid=stale;exp=1;sku=free',
        oauthAccessToken: 'ghu_oauth_secret',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      ...realSecureStorage,
      getSecureStorage: () => ({
        read: () => store,
        update: (next: Record<string, unknown>) => {
          store = next
          return { success: true }
        },
      }),
    }))

    mock.module('../services/github/deviceFlow.js', () => ({
      ...realDeviceFlow,
      DEFAULT_GITHUB_DEVICE_SCOPE: 'read:user',
      exchangeForCopilotToken: async () => ({
        token: `tid=fresh;exp=${futureExp};sku=free`,
        expires_at: futureExp,
        refresh_in: 1500,
        endpoints: { api: 'https://api.githubcopilot.com' },
      }),
    }))

    const { refreshGithubModelsTokenIfNeeded } = await importFreshModule()

    const refreshed = await refreshGithubModelsTokenIfNeeded()
    expect(refreshed).toBe(true)
    expect(process.env.GITHUB_TOKEN?.startsWith('tid=fresh;exp=')).toBe(true)

    const githubModels = (store.githubModels ?? {}) as {
      accessToken?: string
      oauthAccessToken?: string
    }
    expect(githubModels.accessToken?.startsWith('tid=fresh;exp=')).toBe(true)
    expect(githubModels.oauthAccessToken).toBe('ghu_oauth_secret')
  })

  test('does not refresh when current Copilot token is valid', async () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN

    const futureExp = Math.floor(Date.now() / 1000) + 3600
    const exchangeSpy = mock(async () => ({
      token: `tid=unexpected;exp=${futureExp};sku=free`,
      expires_at: futureExp,
      refresh_in: 1500,
      endpoints: { api: 'https://api.githubcopilot.com' },
    }))

    mock.module('./secureStorage/index.js', () => ({
      ...realSecureStorage,
      getSecureStorage: () => ({
        read: () => ({
          githubModels: {
            accessToken: `tid=already-valid;exp=${futureExp};sku=free`,
            oauthAccessToken: 'ghu_oauth_secret',
          },
        }),
        update: () => ({ success: true }),
      }),
    }))

    mock.module('../services/github/deviceFlow.js', () => ({
      ...realDeviceFlow,
      DEFAULT_GITHUB_DEVICE_SCOPE: 'read:user',
      exchangeForCopilotToken: exchangeSpy,
    }))

    const { refreshGithubModelsTokenIfNeeded } = await importFreshModule()

    const refreshed = await refreshGithubModelsTokenIfNeeded()
    expect(refreshed).toBe(false)
    expect(exchangeSpy).not.toHaveBeenCalled()
    expect(process.env.GITHUB_TOKEN?.startsWith('tid=already-valid;exp=')).toBe(
      true,
    )
  })
})

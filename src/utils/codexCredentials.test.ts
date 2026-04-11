/**
 * These tests avoid static imports so Bun can mock secureStorage before
 * codexCredentials is first loaded.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('codexCredentials', () => {
  const originalSimple = process.env.CLAUDE_CODE_SIMPLE
  const originalCodeKey = process.env.CODEX_API_KEY
  const originalFetch = globalThis.fetch

  afterEach(() => {
    mock.restore()
    globalThis.fetch = originalFetch

    if (originalSimple === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = originalSimple
    }

    if (originalCodeKey === undefined) {
      delete process.env.CODEX_API_KEY
    } else {
      process.env.CODEX_API_KEY = originalCodeKey
    }
  })

  test('save returns failure in bare mode', async () => {
    process.env.CLAUDE_CODE_SIMPLE = '1'

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { saveCodexCredentials } = await import(
      './codexCredentials.js?save-bare-mode'
    )

    const result = saveCodexCredentials({
      accessToken: 'token',
      accountId: 'acct_123',
    })

    expect(result.success).toBe(false)
    expect(result.warning).toContain('Bare mode')
  })

  test('saveCodexCredentials refuses plaintext fallback when native secure storage is unavailable', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: (options?: { allowPlainTextFallback?: boolean }) => {
        expect(options?.allowPlainTextFallback).toBe(false)
        return {
          read: () => null,
          readAsync: async () => null,
          update: () => ({
            success: false,
            warning:
              'Secure storage is unavailable on this platform without plaintext fallback.',
          }),
          delete: () => true,
        }
      },
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { saveCodexCredentials } = await import(
      './codexCredentials.js?save-no-plaintext-fallback'
    )

    const result = saveCodexCredentials({
      accessToken: 'token',
      accountId: 'acct_123',
    })

    expect(result.success).toBe(false)
    expect(result.warning).toContain('without plaintext fallback')
  })

  test('refreshCodexAccessTokenIfNeeded refreshes expired stored credentials', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CODEX_API_KEY

    const expiredToken = makeJwt({
      exp: Math.floor((Date.now() - 60_000) / 1000),
      chatgpt_account_id: 'acct_old',
    })
    const freshAccessToken = makeJwt({
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      chatgpt_account_id: 'acct_new',
    })
    const freshIdToken = makeJwt({
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_new',
      },
    })

    let storageState: Record<string, unknown> = {
      codex: {
        accessToken: expiredToken,
        refreshToken: 'refresh-old',
        accountId: 'acct_old',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => storageState,
        readAsync: async () => storageState,
        update: (next: Record<string, unknown>) => {
          storageState = next
          return { success: true }
        },
      }),
    }))

    globalThis.fetch = mock(
      async (_input, init) => {
        const bodyText =
          typeof init?.body === 'string'
            ? init.body
            : init?.body instanceof URLSearchParams
              ? init.body.toString()
              : ''

        if (
          bodyText.includes('grant_type=refresh_token') ||
          bodyText.includes('"grant_type":"refresh_token"')
        ) {
          return new Response(
            JSON.stringify({
              access_token: freshAccessToken,
              refresh_token: 'refresh-new',
              id_token: freshIdToken,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return new Response(
          JSON.stringify({
            access_token: 'codex-api-key-token',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      },
    ) as unknown as typeof fetch

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { refreshCodexAccessTokenIfNeeded, readCodexCredentials } =
      await import('./codexCredentials.js?refresh-success')

    const result = await refreshCodexAccessTokenIfNeeded()
    expect(result.refreshed).toBe(true)

    const stored = readCodexCredentials()
    expect(stored?.accessToken).toBe(freshAccessToken)
    expect(stored?.apiKey).toBe('codex-api-key-token')
    expect(stored?.refreshToken).toBe('refresh-new')
    expect(stored?.accountId).toBe('acct_new')
  })

  test('refreshCodexAccessTokenIfNeeded backs off after a failed refresh attempt', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CODEX_API_KEY

    const expiredToken = makeJwt({
      exp: Math.floor((Date.now() - 60_000) / 1000),
      chatgpt_account_id: 'acct_old',
    })

    let storageState: Record<string, unknown> = {
      codex: {
        accessToken: expiredToken,
        refreshToken: 'refresh-old',
        accountId: 'acct_old',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => storageState,
        readAsync: async () => storageState,
        update: (next: Record<string, unknown>) => {
          storageState = next
          return { success: true }
        },
      }),
    }))

    let refreshAttempts = 0
    globalThis.fetch = mock(async () => {
      refreshAttempts += 1
      return new Response(
        JSON.stringify({
          error: {
            code: 'invalid_grant',
            message: 'refresh token expired',
          },
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )
    }) as unknown as typeof fetch

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { refreshCodexAccessTokenIfNeeded, readCodexCredentials } =
      await import('./codexCredentials.js?refresh-cooldown')

    await expect(refreshCodexAccessTokenIfNeeded()).rejects.toThrow(
      'Codex token refresh failed (invalid_grant): refresh token expired',
    )

    const afterFailure = readCodexCredentials()
    expect(typeof afterFailure?.lastRefreshFailureAt).toBe('number')

    const secondAttempt = await refreshCodexAccessTokenIfNeeded()
    expect(secondAttempt.refreshed).toBe(false)
    expect(secondAttempt.credentials?.accessToken).toBe(expiredToken)
    expect(refreshAttempts).toBe(1)
  })

  test('refreshCodexAccessTokenIfNeeded drops a stale api key when id-token exchange fails', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CODEX_API_KEY

    const expiredToken = makeJwt({
      exp: Math.floor((Date.now() - 60_000) / 1000),
      chatgpt_account_id: 'acct_old',
    })
    const freshAccessToken = makeJwt({
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      chatgpt_account_id: 'acct_new',
    })
    const freshIdToken = makeJwt({
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_new',
      },
    })

    let storageState: Record<string, unknown> = {
      codex: {
        apiKey: 'stale-api-key',
        accessToken: expiredToken,
        refreshToken: 'refresh-old',
        accountId: 'acct_old',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => storageState,
        readAsync: async () => storageState,
        update: (next: Record<string, unknown>) => {
          storageState = next
          return { success: true }
        },
      }),
    }))

    globalThis.fetch = mock(
      async (_input, init) => {
        const bodyText =
          typeof init?.body === 'string'
            ? init.body
            : init?.body instanceof URLSearchParams
              ? init.body.toString()
              : ''

        if (bodyText.includes('grant_type=refresh_token')) {
          return new Response(
            JSON.stringify({
              access_token: freshAccessToken,
              refresh_token: 'refresh-new',
              id_token: freshIdToken,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return new Response('exchange failed', {
          status: 500,
        })
      },
    ) as unknown as typeof fetch

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { refreshCodexAccessTokenIfNeeded, readCodexCredentials } =
      await import('./codexCredentials.js?refresh-drop-stale-api-key')

    const result = await refreshCodexAccessTokenIfNeeded()
    expect(result.refreshed).toBe(true)

    const stored = readCodexCredentials()
    expect(stored?.accessToken).toBe(freshAccessToken)
    expect(stored?.apiKey).toBeUndefined()
    expect(stored?.refreshToken).toBe('refresh-new')
    expect(stored?.accountId).toBe('acct_new')
  })

  test('refreshCodexAccessTokenIfNeeded deduplicates concurrent refresh attempts', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CODEX_API_KEY

    const expiredToken = makeJwt({
      exp: Math.floor((Date.now() - 60_000) / 1000),
      chatgpt_account_id: 'acct_old',
    })
    const freshAccessToken = makeJwt({
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      chatgpt_account_id: 'acct_new',
    })
    const freshIdToken = makeJwt({
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_new',
      },
    })

    let storageState: Record<string, unknown> = {
      codex: {
        accessToken: expiredToken,
        refreshToken: 'refresh-old',
        accountId: 'acct_old',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => storageState,
        readAsync: async () => storageState,
        update: (next: Record<string, unknown>) => {
          storageState = next
          return { success: true }
        },
      }),
    }))

    let refreshAttempts = 0
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve
    })

    globalThis.fetch = mock(async (_input, init) => {
      const bodyText =
        typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : ''

      if (bodyText.includes('grant_type=refresh_token')) {
        refreshAttempts += 1
        await refreshGate
        return new Response(
          JSON.stringify({
            access_token: freshAccessToken,
            refresh_token: 'refresh-new',
            id_token: freshIdToken,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      return new Response(
        JSON.stringify({
          access_token: 'codex-api-key-token',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )
    }) as unknown as typeof fetch

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { refreshCodexAccessTokenIfNeeded } = await import(
      './codexCredentials.js?refresh-dedupe'
    )

    const firstRefresh = refreshCodexAccessTokenIfNeeded()
    const secondRefresh = refreshCodexAccessTokenIfNeeded()
    releaseRefresh?.()

    const [firstResult, secondResult] = await Promise.all([
      firstRefresh,
      secondRefresh,
    ])

    expect(refreshAttempts).toBe(1)
    expect(firstResult).toEqual(secondResult)
    expect(firstResult.refreshed).toBe(true)
    expect(firstResult.credentials?.accessToken).toBe(freshAccessToken)
  })

  test('saveCodexCredentials preserves an existing linked profile id', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE

    let storageState: Record<string, unknown> = {
      codex: {
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        accountId: 'acct_old',
        profileId: 'profile_codex_oauth',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => storageState,
        readAsync: async () => storageState,
        update: (next: Record<string, unknown>) => {
          storageState = next
          return { success: true }
        },
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { readCodexCredentials, saveCodexCredentials } = await import(
      './codexCredentials.js?preserve-profile-id'
    )

    const saved = saveCodexCredentials({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      accountId: 'acct_new',
    })

    expect(saved.success).toBe(true)
    expect(readCodexCredentials()?.profileId).toBe('profile_codex_oauth')
  })

  test('attachCodexProfileIdToStoredCredentials links the saved profile id', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE

    let storageState: Record<string, unknown> = {
      codex: {
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        accountId: 'acct_old',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => storageState,
        readAsync: async () => storageState,
        update: (next: Record<string, unknown>) => {
          storageState = next
          return { success: true }
        },
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const {
      attachCodexProfileIdToStoredCredentials,
      readCodexCredentials,
    } = await import('./codexCredentials.js?attach-profile-id')

    const result =
      attachCodexProfileIdToStoredCredentials('profile_codex_oauth')

    expect(result.success).toBe(true)
    expect(readCodexCredentials()?.profileId).toBe('profile_codex_oauth')
  })

  test('refreshCodexAccessTokenIfNeeded uses async secure-storage reads in its request path', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CODEX_API_KEY

    const freshToken = makeJwt({
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      chatgpt_account_id: 'acct_async',
    })

    let storageState: Record<string, unknown> = {
      codex: {
        accessToken: freshToken,
        refreshToken: 'refresh-async',
        accountId: 'acct_async',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => {
          throw new Error(
            'sync storage read should not run during refresh checks',
          )
        },
        readAsync: async () => storageState,
        update: (next: Record<string, unknown>) => {
          storageState = next
          return { success: true }
        },
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { refreshCodexAccessTokenIfNeeded } = await import(
      './codexCredentials.js?refresh-async-read'
    )

    const result = await refreshCodexAccessTokenIfNeeded()
    expect(result.refreshed).toBe(false)
    expect(result.credentials?.accessToken).toBe(freshToken)
  })

  test('refreshCodexAccessTokenIfNeeded keeps a cooldown in memory when secure storage cannot persist it', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CODEX_API_KEY

    const expiredToken = makeJwt({
      exp: Math.floor((Date.now() - 60_000) / 1000),
      chatgpt_account_id: 'acct_old',
    })

    const storageState: Record<string, unknown> = {
      codex: {
        accessToken: expiredToken,
        refreshToken: 'refresh-old',
        accountId: 'acct_old',
      },
    }

    mock.module('./secureStorage/index.js', () => ({
      getSecureStorage: () => ({
        read: () => storageState,
        readAsync: async () => storageState,
        update: () => ({
          success: false,
          warning: 'secure storage unavailable',
        }),
      }),
    }))

    let refreshAttempts = 0
    globalThis.fetch = mock(async () => {
      refreshAttempts += 1
      return new Response(
        JSON.stringify({
          error: {
            code: 'invalid_grant',
            message: 'refresh token expired',
          },
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )
    }) as unknown as typeof fetch

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { refreshCodexAccessTokenIfNeeded } = await import(
      './codexCredentials.js?refresh-memory-cooldown'
    )

    await expect(refreshCodexAccessTokenIfNeeded()).rejects.toThrow(
      'Codex token refresh failed (invalid_grant): refresh token expired',
    )

    const secondAttempt = await refreshCodexAccessTokenIfNeeded()
    expect(secondAttempt.refreshed).toBe(false)
    expect(secondAttempt.credentials?.accessToken).toBe(expiredToken)
    expect(refreshAttempts).toBe(1)
  })
})

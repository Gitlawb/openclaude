import { afterEach, describe, expect, mock, test } from 'bun:test'
import * as realFs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as realOs from 'node:os'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('resolveCodexApiCredentials with secure storage', () => {
  afterEach(() => {
    mock.restore()
  })

  test('loads Codex credentials from OpenClaude secure storage', async () => {
    mock.module('../../utils/codexCredentials.js', () => ({
      isCodexRefreshFailureCoolingDown: () => false,
      readCodexCredentials: () => ({
        apiKey: 'codex-api-key-token',
        accessToken: 'header.payload.signature',
        accountId: 'acct_secure',
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { resolveCodexApiCredentials } = await import(
      './providerConfig.js?codex-secure-storage'
    )

    const credentials = resolveCodexApiCredentials({} as NodeJS.ProcessEnv)
    expect(credentials.apiKey).toBe('codex-api-key-token')
    expect(credentials.accountId).toBe('acct_secure')
    expect(credentials.source).toBe('secure-storage')
  })

  test('prefers explicit env credentials over secure storage', async () => {
    mock.module('../../utils/codexCredentials.js', () => ({
      isCodexRefreshFailureCoolingDown: () => false,
      readCodexCredentials: () => ({
        accessToken: 'stored-token',
        accountId: 'acct_stored',
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { resolveCodexApiCredentials } = await import(
      './providerConfig.js?codex-env-precedence'
    )

    const credentials = resolveCodexApiCredentials({
      CODEX_API_KEY: 'env-token',
      CHATGPT_ACCOUNT_ID: 'acct_env',
    } as NodeJS.ProcessEnv)

    expect(credentials.apiKey).toBe('env-token')
    expect(credentials.accountId).toBe('acct_env')
    expect(credentials.source).toBe('env')
  })

  test('parses nested chatgpt_account_id from a CODEX_API_KEY JWT', async () => {
    mock.module('../../utils/codexCredentials.js', () => ({
      isCodexRefreshFailureCoolingDown: () => false,
      readCodexCredentials: () => undefined,
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { resolveCodexApiCredentials } = await import(
      './providerConfig.js?codex-env-nested-account'
    )

    const credentials = resolveCodexApiCredentials({
      CODEX_API_KEY: makeJwt({
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_nested_env',
        },
      }),
    } as NodeJS.ProcessEnv)

    expect(credentials.accountId).toBe('acct_nested_env')
    expect(credentials.source).toBe('env')
  })

  test('parses nested chatgpt_account_id from auth.json tokens', async () => {
    mock.module('node:fs', () => realFs)
    mock.module('../../utils/codexCredentials.js', () => ({
      isCodexRefreshFailureCoolingDown: () => false,
      readCodexCredentials: () => undefined,
    }))

    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-codex-auth-'))
    const authPath = join(tempDir, 'auth.json')

    writeFileSync(
      authPath,
      JSON.stringify({
        openai_api_key: makeJwt({
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct_nested_auth_json',
          },
        }),
      }),
      'utf8',
    )

    try {
      // @ts-expect-error cache-busting query string for Bun module mocks
      const { resolveCodexApiCredentials } = await import(
        './providerConfig.js?codex-auth-json-nested-account'
      )

      const credentials = resolveCodexApiCredentials({
        CODEX_AUTH_JSON_PATH: authPath,
      } as NodeJS.ProcessEnv)

      expect(credentials.accountId).toBe('acct_nested_auth_json')
      expect(credentials.source).toBe('auth.json')
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })

  test('does not read default auth.json when secure storage already has Codex credentials', async () => {
    let touchedDefaultAuthJson = false
    mock.module('node:fs', () => ({
      existsSync: () => {
        touchedDefaultAuthJson = true
        return false
      },
      readFileSync: () => {
        touchedDefaultAuthJson = true
        return ''
      },
    }))
    mock.module('../../utils/codexCredentials.js', () => ({
      isCodexRefreshFailureCoolingDown: () => false,
      readCodexCredentials: () => ({
        apiKey: 'codex-api-key-token',
        accessToken: 'header.payload.signature',
        accountId: 'acct_secure',
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { resolveCodexApiCredentials } = await import(
      './providerConfig.js?codex-secure-storage-no-auth-io'
    )

    const credentials = resolveCodexApiCredentials({} as NodeJS.ProcessEnv)
    expect(credentials.apiKey).toBe('codex-api-key-token')
    expect(credentials.accountId).toBe('acct_secure')
    expect(credentials.source).toBe('secure-storage')
    expect(touchedDefaultAuthJson).toBe(false)
  })

  test('falls back to the default auth.json when stored Codex refresh is cooling down', async () => {
    const expectedAuthPath = join(realOs.homedir(), '.codex', 'auth.json')
    const authJson = JSON.stringify({
      openai_api_key: makeJwt({
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_auth_json',
        },
      }),
    })

    mock.module('node:fs', () => ({
      ...realFs,
      existsSync: (path: realFs.PathLike) =>
        String(path) === expectedAuthPath || realFs.existsSync(path),
      readFileSync: (
        path: realFs.PathLike | number,
        options?: Parameters<typeof realFs.readFileSync>[1],
      ) => {
        if (String(path) === expectedAuthPath) {
          return authJson
        }
        return realFs.readFileSync(path as never, options as never)
      },
    }))

    mock.module('../../utils/codexCredentials.js', () => ({
      isCodexRefreshFailureCoolingDown: () => true,
      readCodexCredentials: () => ({
        accessToken: 'stored-token',
        refreshToken: 'refresh-stored',
        accountId: 'acct_stored',
        lastRefreshFailureAt: Date.now(),
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { resolveCodexApiCredentials } = await import(
      './providerConfig.js?codex-refresh-cooldown-fallback'
    )

    const credentials = resolveCodexApiCredentials({} as NodeJS.ProcessEnv)
    expect(credentials.source).toBe('auth.json')
    expect(credentials.accountId).toBe('acct_auth_json')
    expect(credentials.apiKey).not.toBe('stored-token')
  })

  test('preserves the stored account id when auth.json fallback lacks one', async () => {
    const expectedAuthPath = join(realOs.homedir(), '.codex', 'auth.json')
    const authJson = JSON.stringify({
      openai_api_key: 'auth-json-access-token',
    })

    mock.module('node:fs', () => ({
      ...realFs,
      existsSync: (path: realFs.PathLike) =>
        String(path) === expectedAuthPath || realFs.existsSync(path),
      readFileSync: (
        path: realFs.PathLike | number,
        options?: Parameters<typeof realFs.readFileSync>[1],
      ) => {
        if (String(path) === expectedAuthPath) {
          return authJson
        }
        return realFs.readFileSync(path as never, options as never)
      },
    }))

    mock.module('../../utils/codexCredentials.js', () => ({
      isCodexRefreshFailureCoolingDown: () => true,
      readCodexCredentials: () => ({
        accessToken: 'stored-token',
        refreshToken: 'refresh-stored',
        accountId: 'acct_stored',
        lastRefreshFailureAt: Date.now(),
      }),
    }))

    // @ts-expect-error cache-busting query string for Bun module mocks
    const { resolveCodexApiCredentials } = await import(
      './providerConfig.js?codex-refresh-cooldown-account-id-fallback'
    )

    const credentials = resolveCodexApiCredentials({} as NodeJS.ProcessEnv)
    expect(credentials.source).toBe('auth.json')
    expect(credentials.apiKey).toBe('auth-json-access-token')
    expect(credentials.accountId).toBe('acct_stored')
  })
})

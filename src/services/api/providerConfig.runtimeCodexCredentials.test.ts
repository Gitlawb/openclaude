import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveRuntimeCodexCredentials } from './providerConfig.js'

afterEach(() => {
  mock.restore()
})

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

test('runtime credential resolution honors explicit auth.json over stored secure-storage tokens', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-codex-explicit-auth-'))
  const authPath = join(tempDir, 'auth.json')

  writeFileSync(
    authPath,
    JSON.stringify({
      openai_api_key: makeJwt({
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_explicit_auth_json',
        },
      }),
    }),
    'utf8',
  )

  try {
    const credentials = resolveRuntimeCodexCredentials({
      env: {
        CODEX_AUTH_JSON_PATH: authPath,
      } as NodeJS.ProcessEnv,
      storedCredentials: {
        apiKey: 'stored-api-key',
        accessToken: 'stored-access-token',
        accountId: 'acct_stored',
      },
    })

    expect(credentials.source).toBe('auth.json')
    expect(credentials.accountId).toBe('acct_explicit_auth_json')
    expect(credentials.apiKey).not.toBe('stored-api-key')
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

test('runtime credential resolution preserves an explicit auth.json path even when it is missing', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-codex-missing-auth-'))
  const authPath = join(tempDir, 'missing-auth.json')

  try {
    const credentials = resolveRuntimeCodexCredentials({
      env: {
        CODEX_AUTH_JSON_PATH: authPath,
      } as NodeJS.ProcessEnv,
      storedCredentials: {
        apiKey: 'stored-api-key',
        accessToken: 'stored-access-token',
        accountId: 'acct_stored',
      },
    })

    expect(credentials.source).toBe('none')
    expect(credentials.authPath).toBe(authPath)
    expect(credentials.apiKey).toBe('')
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

test('runtime credential resolution avoids sync secure-storage reads when async credentials are provided', async () => {
  let syncReadCalled = false

  mock.module('../../utils/codexCredentials.js', () => ({
    isCodexRefreshFailureCoolingDown: () => false,
    readCodexCredentials: () => {
      syncReadCalled = true
      throw new Error('sync secure-storage read should not run in runtime resolution')
    },
  }))

  const { resolveRuntimeCodexCredentials } = await import(
    // @ts-expect-error cache-busting query string for Bun module mocks
    './providerConfig.js?runtime-no-sync-secure-storage'
  )

  const credentials = resolveRuntimeCodexCredentials({
    env: {} as NodeJS.ProcessEnv,
    storedCredentials: {
      accessToken: 'stored-access-token',
      accountId: 'acct_stored',
    },
  })

  expect(syncReadCalled).toBe(false)
  expect(credentials.source).toBe('secure-storage')
  expect(credentials.apiKey).toBe('stored-access-token')
  expect(credentials.accountId).toBe('acct_stored')
})

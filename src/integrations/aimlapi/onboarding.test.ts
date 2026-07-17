import { afterEach, expect, mock, test } from 'bun:test'

import {
  beginAimlapiEmailOnboarding,
  completeAimlapiCodeSignIn,
  validateAimlapiApiKey,
} from './onboarding.js'

const originalFetch = globalThis.fetch
const originalEnv = {
  AIMLAPI_AUTH_URL: process.env.AIMLAPI_AUTH_URL,
  AIMLAPI_APP_URL: process.env.AIMLAPI_APP_URL,
  AIMLAPI_INFERENCE_URL: process.env.AIMLAPI_INFERENCE_URL,
}

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

test('existing account onboarding sends a code, creates a key, and reports low balance', async () => {
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method} ${url}`)
    if (url.endsWith('/v1/auth/account')) return response({ action: 'sign-in' })
    if (url.endsWith('/v1/auth/sign-in/code')) return new Response('', { status: 204 })
    if (url.endsWith('/code/verify')) return response({ token: 'session', exp: 1 })
    if (url.endsWith('/v1/keys')) return response({ key: 'key_test', id: 'id_test' })
    if (url.endsWith('/billing/balance')) {
      return response({ balance: 5, lowBalance: true, lowBalanceThreshold: 20 })
    }
    return response({}, 404)
  }) as unknown as typeof fetch

  expect(await beginAimlapiEmailOnboarding('user@example.com')).toEqual({
    action: 'code-sent',
  })
  expect(await completeAimlapiCodeSignIn('user@example.com', '123456')).toEqual({
    sessionToken: 'session',
    apiKey: 'key_test',
    apiKeyId: 'id_test',
    balanceStatus: 'confirmed',
    lowBalance: true,
  })
  expect(calls).toEqual([
    'PATCH https://auth.example.test/v1/auth/account',
    'POST https://auth.example.test/v1/auth/sign-in/code',
    'POST https://auth.example.test/v1/auth/sign-in/code/verify',
    'POST https://app.example.test/v1/keys',
    'GET https://api.example.test/v1/billing/balance',
  ])
})

test('balance failures preserve the issued key without marking it ready', async () => {
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/code/verify')) return response({ token: 'session', exp: 1 })
    if (url.endsWith('/v1/keys')) return response({ key: 'key_test', id: 'id_test' })
    return response({ error: 'unavailable' }, 503)
  }) as unknown as typeof fetch

  const result = await completeAimlapiCodeSignIn('user@example.com', '123456')
  expect(result).toEqual({
    sessionToken: 'session',
    apiKey: 'key_test',
    apiKeyId: 'id_test',
    balanceStatus: 'unknown',
    balanceError: 'GET https://api.example.test -> 503',
  })
  expect(result).not.toHaveProperty('lowBalance')
})

test('new account onboarding returns a passwordless session', async () => {
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    return url.endsWith('/passwordless')
      ? response({ token: 'new-session', exp: 1 })
      : response({ action: 'sign-up' })
  }) as unknown as typeof fetch

  expect(await beginAimlapiEmailOnboarding('new@example.com')).toEqual({
    action: 'new-account',
    sessionToken: 'new-session',
  })
})

test('existing API key validation uses the balance endpoint', async () => {
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe('https://api.example.test/v1/billing/balance')
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer key_test')
    return response({ balance: 25, lowBalance: false, lowBalanceThreshold: 20 })
  }) as unknown as typeof fetch

  expect(await validateAimlapiApiKey(' key_test ')).toEqual({
    balance: 25,
    lowBalance: false,
    lowBalanceThreshold: 20,
  })
})

test('existing API key validation can pin the validated endpoint', async () => {
  process.env.AIMLAPI_INFERENCE_URL = 'https://override.example.test/v1'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    expect(String(input)).toBe('https://api.aimlapi.com/v1/billing/balance')
    return response({ balance: 25, lowBalance: false, lowBalanceThreshold: 20 })
  }) as unknown as typeof fetch

  await validateAimlapiApiKey(
    'key_test',
    undefined,
    'https://api.aimlapi.com/v1',
  )
})

test('unknown account actions are rejected instead of signing up', async () => {
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  globalThis.fetch = mock(async () => response({ action: 'migrate' })) as unknown as typeof fetch
  await expect(beginAimlapiEmailOnboarding('user@example.com')).rejects.toThrow(
    'unsupported account action',
  )
})

test('completeAimlapiCodeSignIn reuses a supplied key instead of minting a new one', async () => {
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/code/verify')) return response({ token: 'bearer', exp: 1 })
    if (url.endsWith('/billing/balance')) {
      return response({ balance: 100, lowBalance: false, lowBalanceThreshold: 20 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  const result = await completeAimlapiCodeSignIn(
    'user@example.com',
    '123456',
    undefined,
    'https://api.example.test/v1',
    { apiKey: 'existing-key', apiKeyId: 'existing-id' },
  )

  expect(result.apiKey).toBe('existing-key')
  expect(result.apiKeyId).toBe('existing-id')
  // No key was minted; only verify + balance were called.
  expect(calls.some(call => call.endsWith('/v1/keys'))).toBe(false)
})

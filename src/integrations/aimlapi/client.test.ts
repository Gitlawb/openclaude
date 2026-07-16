import { afterEach, expect, mock, test } from 'bun:test'

import { AimlapiClient } from './client.js'
import type { AimlapiEndpoints } from './config.js'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const endpoints: AimlapiEndpoints = {
  authBaseUrl: 'https://auth.example.test',
  appBaseUrl: 'https://app.example.test',
  inferenceBaseUrl: 'https://api.example.test/v1',
  payBaseUrl: 'https://pay.example.test',
  verificationBaseUrl: 'https://front.example.test',
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('passwordless onboarding methods use the current backend contracts', async () => {
  const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      init,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    if (url.endsWith('/v1/auth/account') && init?.method === 'PATCH') {
      return jsonResponse({ action: 'sign-in' })
    }
    if (url.endsWith('/code/verify')) return jsonResponse({ token: 'bearer', exp: 1 })
    if (url.endsWith('/passwordless')) return jsonResponse({ token: 'new-bearer', exp: 2 })
    if (url.endsWith('/v1/keys')) return jsonResponse({ key: 'key_test', id: 'id_test' })
    if (url.endsWith('/billing/balance')) {
      return jsonResponse({ balance: 10, lowBalance: true, lowBalanceThreshold: 20 })
    }
    return new Response('', { status: 204 })
  }) as unknown as typeof fetch

  const client = new AimlapiClient(endpoints)
  expect(await client.checkAccount('user@example.com')).toEqual({ action: 'sign-in' })
  await client.sendSignInCode('user@example.com')
  expect(await client.verifySignInCode('user@example.com', '123456')).toEqual({
    token: 'bearer',
    exp: 1,
  })
  expect(await client.createPasswordlessAccount('new@example.com')).toEqual({
    token: 'new-bearer',
    exp: 2,
  })
  expect(await client.createKey('bearer', 'OpenClaude CLI')).toEqual({
    key: 'key_test',
    id: 'id_test',
  })
  expect((await client.getBalance('key_test')).lowBalance).toBe(true)

  expect(calls.map(call => [call.init?.method, call.url, call.body])).toEqual([
    ['PATCH', 'https://auth.example.test/v1/auth/account', { email: 'user@example.com' }],
    ['POST', 'https://auth.example.test/v1/auth/sign-in/code', { email: 'user@example.com' }],
    ['POST', 'https://auth.example.test/v1/auth/sign-in/code/verify', { email: 'user@example.com', code: '123456' }],
    ['POST', 'https://auth.example.test/v1/auth/account/passwordless', { email: 'new@example.com' }],
    ['POST', 'https://app.example.test/v1/keys', { name: 'OpenClaude CLI' }],
    ['GET', 'https://api.example.test/v1/billing/balance', undefined],
  ])
})

test('pay only sends autoTopUp when it is enabled', async () => {
  const bodies: unknown[] = []
  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined)
    return jsonResponse({
      checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test' },
      partnerCheckout: { sessionToken: 'session' },
    })
  }) as unknown as typeof fetch

  const client = new AimlapiClient(endpoints)
  await client.pay('bearer', 'session', {
    amountUsdMinor: 2500,
    paymentSessionId: 'payment-id',
  })
  await client.pay('bearer', 'session', {
    amountUsdMinor: 2500,
    paymentSessionId: 'payment-id',
    autoTopUp: true,
  })
  expect(bodies).toEqual([
    { amountUsdMinor: 2500, paymentSessionId: 'payment-id', method: 'card' },
    { amountUsdMinor: 2500, paymentSessionId: 'payment-id', method: 'card', autoTopUp: true },
  ])
})

test('topUpByKey uses the v2 billing endpoint and API key bearer', async () => {
  let seenUrl = ''
  let seenHeaders = new Headers()
  let seenBody: unknown
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(input)
    seenHeaders = new Headers(init?.headers)
    seenBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    return jsonResponse({
      checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test' },
      partnerCheckout: { sessionToken: 'session' },
    })
  }) as unknown as typeof fetch

  const client = new AimlapiClient(endpoints)
  await client.topUpByKey('key_test', {
    sessionToken: 'session',
    amountUsdMinor: 2500,
    paymentSessionId: 'payment-id',
    autoTopUp: true,
  })

  expect(seenUrl).toBe('https://api.example.test/v2/billing/topup')
  expect(seenHeaders.get('Authorization')).toBe('Bearer key_test')
  expect(seenBody).toEqual({
    sessionToken: 'session',
    amountUsdMinor: 2500,
    paymentSessionId: 'payment-id',
    autoTopUp: true,
  })
})

test('typed requests reject an empty successful response', async () => {
  globalThis.fetch = mock(async () => new Response('', { status: 204 })) as unknown as typeof fetch
  const client = new AimlapiClient(endpoints)
  await expect(client.getBalance('key_test')).rejects.toThrow('returned empty body')
})

test('response bodies are capped before decoding or surfacing errors', async () => {
  globalThis.fetch = mock(
    async () => new Response('x'.repeat((1 << 20) + 1), { status: 502 }),
  ) as unknown as typeof fetch
  const client = new AimlapiClient(endpoints)
  await expect(client.getBalance('key_test')).rejects.toThrow(
    'response body exceeds 1048576 bytes',
  )
})

test('token-producing methods reject an empty token', async () => {
  globalThis.fetch = mock(async () => jsonResponse({ token: '', exp: 1 })) as unknown as typeof fetch
  const client = new AimlapiClient(endpoints)
  await expect(client.verifySignInCode('user@example.com', '123456')).rejects.toThrow(
    'did not return an auth token',
  )
  await expect(client.createPasswordlessAccount('user@example.com')).rejects.toThrow(
    'did not return an auth token',
  )
})

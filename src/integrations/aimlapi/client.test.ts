import { afterEach, expect, mock, test } from 'bun:test'

import { AimlapiApiError, AimlapiClient } from './client.js'
import type { AimlapiEndpoints } from './config.js'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const endpoints: AimlapiEndpoints = {
  authBaseUrl: 'https://auth.example.test',
  appBaseUrl: 'https://app.example.test',
  inferenceBaseUrl: 'https://api.example.test/v1',
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

test('pay carries the selected method and omits an absent payment session id', async () => {
  // The password flow lets the user pick crypto and has no payment session id;
  // both must survive alongside the passwordless defaults.
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
    method: 'crypto',
    successUrl: 'https://ok.test',
  })
  expect(bodies).toEqual([
    { amountUsdMinor: 2500, method: 'crypto', successUrl: 'https://ok.test' },
  ])
})

test('password sign-up and sign-in keep their existing contracts', async () => {
  const calls: Array<{ method?: string; url: string; body?: unknown }> = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method,
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return jsonResponse({ token: 'legacy-bearer', exp: 7 })
  }) as unknown as typeof fetch

  const client = new AimlapiClient(endpoints)
  expect(
    await client.signup({
      email: 'user@example.com',
      password: 'secret',
      inviteCode: 'invite',
    }),
  ).toEqual({ token: 'legacy-bearer', exp: 7 })
  expect(await client.login('user@example.com', 'secret')).toEqual({
    token: 'legacy-bearer',
    exp: 7,
  })

  expect(calls).toEqual([
    {
      method: 'POST',
      url: 'https://auth.example.test/v1/auth/account',
      body: { email: 'user@example.com', password: 'secret', inviteCode: 'invite' },
    },
    {
      method: 'PUT',
      url: 'https://auth.example.test/v1/auth/account',
      body: { email: 'user@example.com', password: 'secret' },
    },
  ])
})

test('password methods reject a response without a token', async () => {
  globalThis.fetch = mock(async () => jsonResponse({ exp: 1 })) as unknown as typeof fetch

  const client = new AimlapiClient(endpoints)
  // A malformed success payload must surface the same error contract as every
  // other endpoint, so a caller can branch on the type/status uniformly instead
  // of special-casing the auth paths.
  for (const call of [
    () => client.signup({ email: 'user@example.com', password: 'secret' }),
    () => client.login('user@example.com', 'secret'),
  ]) {
    const error = await call().then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(AimlapiApiError)
    expect((error as AimlapiApiError).status).toBe(200)
    expect((error as AimlapiApiError).message).toContain('did not return an auth token')
  }
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

test('getBalance rejects malformed successful payloads', async () => {
  const client = new AimlapiClient(endpoints)
  for (const payload of [
    {},
    { balance: 25, lowBalance: false },
    { balance: '25', lowBalance: false, lowBalanceThreshold: 20 },
    { balance: 25, lowBalance: 'false', lowBalanceThreshold: 20 },
    { balance: 25, lowBalance: false, lowBalanceThreshold: null },
  ]) {
    globalThis.fetch = mock(async () => jsonResponse(payload)) as unknown as typeof fetch
    await expect(client.getBalance('key_test')).rejects.toThrow(
      'returned invalid balance response',
    )
  }
})

test('session tokens are excluded from HTTP and network errors', async () => {
  const client = new AimlapiClient(endpoints)
  const token = 'session-secret-token'

  globalThis.fetch = mock(async () => new Response('failed', { status: 500 })) as unknown as typeof fetch
  let httpError: unknown
  try {
    await client.getSession(token)
  } catch (error) {
    httpError = error
  }
  expect(httpError).toBeInstanceOf(Error)
  expect((httpError as Error).message).toContain('https://app.example.test')
  expect((httpError as Error).message).not.toContain(token)

  globalThis.fetch = mock(async () => {
    throw new Error(`transport failed for ${token}`)
  }) as unknown as typeof fetch
  let networkError: unknown
  try {
    await client.exchange('bearer', token)
  } catch (error) {
    networkError = error
  }
  expect(networkError).toBeInstanceOf(Error)
  expect((networkError as Error).message).not.toContain(token)
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

test('a request forwards the abort signal to fetch and rejects when cancelled', async () => {
  const controller = new AbortController()
  let forwardedSignal: AbortSignal | undefined
  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    forwardedSignal = init?.signal ?? undefined
    // Model a transport that only settles when the request is aborted.
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('The operation was aborted.', 'AbortError')),
        { once: true },
      )
    })
  }) as unknown as typeof fetch

  const client = new AimlapiClient(endpoints)
  const pending = client.getSession('resume-token', controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow()
  // The signal reached the transport layer and observed the cancellation.
  expect(forwardedSignal).toBeInstanceOf(AbortSignal)
  expect(forwardedSignal?.aborted).toBe(true)
})

test('session methods reject a malformed or empty success payload', async () => {
  // A structurally-invalid 200 must surface as a non-terminal (status 200)
  // error rather than a session with an unknown status, so callers never clear
  // the retained payment identity or take an ambiguous retry on it.
  const client = new AimlapiClient(endpoints)

  // Empty object: passes the request-level object guard, rejected by the
  // session shape check (no valid status).
  globalThis.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch
  const emptyError = await client.getSession('resume-token').catch((error: unknown) => error)
  expect(emptyError).toBeInstanceOf(AimlapiApiError)
  expect(emptyError).toHaveProperty('status', 200)

  // null / non-object: rejected by the request-level guard.
  globalThis.fetch = mock(async () => jsonResponse(null)) as unknown as typeof fetch
  const nullError = await client.getSession('resume-token').catch((error: unknown) => error)
  expect(nullError).toBeInstanceOf(AimlapiApiError)
  expect(nullError).toHaveProperty('status', 200)

  // Unknown status: object with a status outside the allowlist.
  globalThis.fetch = mock(async () =>
    jsonResponse({ sessionToken: 'session', status: 'nonsense' }),
  ) as unknown as typeof fetch
  const badStatusError = await client
    .createSession({ partnerId: 'part_x' })
    .catch((error: unknown) => error)
  expect(badStatusError).toBeInstanceOf(AimlapiApiError)
  expect(badStatusError).toHaveProperty('status', 200)
})

test('typed methods reject wrong-typed success fields without a raw TypeError', async () => {
  const client = new AimlapiClient(endpoints)

  // A 2xx payload with a numeric token/key/apiKey must not reach .trim().
  globalThis.fetch = mock(async () => jsonResponse({ token: 1 })) as unknown as typeof fetch
  await expect(client.verifySignInCode('user@example.com', '123456')).rejects.toThrow(
    'did not return an auth token',
  )
  await expect(client.createPasswordlessAccount('user@example.com')).rejects.toThrow(
    'did not return an auth token',
  )

  globalThis.fetch = mock(async () => jsonResponse({ key: 1 })) as unknown as typeof fetch
  await expect(client.createKey('bearer', 'OpenClaude CLI')).rejects.toThrow(
    'did not return an API key',
  )
  // Key without its required id is an incomplete receipt and must be rejected.
  globalThis.fetch = mock(async () => jsonResponse({ key: 'k_only' })) as unknown as typeof fetch
  await expect(client.createKey('bearer', 'OpenClaude CLI')).rejects.toThrow(
    'did not return an API key',
  )

  globalThis.fetch = mock(async () => jsonResponse({ apiKey: 1 })) as unknown as typeof fetch
  const exchangeError = await client.exchange('bearer', 'session').catch((e: unknown) => e)
  expect(exchangeError).toBeInstanceOf(AimlapiApiError)
  expect(exchangeError).toHaveProperty('status', 200)

  // apiKey without its required apiKeyId is an incomplete exchange receipt.
  globalThis.fetch = mock(async () =>
    jsonResponse({ apiKey: 'k_only' }),
  ) as unknown as typeof fetch
  const partialExchange = await client.exchange('bearer', 'session').catch((e: unknown) => e)
  expect(partialExchange).toBeInstanceOf(AimlapiApiError)
  expect(partialExchange).toHaveProperty('status', 200)

  globalThis.fetch = mock(async () => jsonResponse({ action: 1 })) as unknown as typeof fetch
  const accountError = await client.checkAccount('user@example.com').catch((e: unknown) => e)
  expect(accountError).toBeInstanceOf(AimlapiApiError)
  expect(accountError).toHaveProperty('status', 200)
})

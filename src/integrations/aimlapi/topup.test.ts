import { afterEach, expect, mock, test } from 'bun:test'

import { isValidAimlapiEmail, parseAimlapiAmountUsd } from './validation.js'

mock.module('./topupDependencies.js', () => ({
  openBrowser: async () => {},
  saveProfileFile: () => 'profile.json',
  promptText: async () => '',
}))
const { pollUntilPaid, provisionAimlapiKey, topUpAimlapiByApiKey } =
  await import('./topup.js')
const { AimlapiClient } = await import('./client.js')

const originalFetch = globalThis.fetch
const originalEnv = {
  AIMLAPI_APP_URL: process.env.AIMLAPI_APP_URL,
  AIMLAPI_INFERENCE_URL: process.env.AIMLAPI_INFERENCE_URL,
  AIMLAPI_PAY_URL: process.env.AIMLAPI_PAY_URL,
}

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('parseAimlapiAmountUsd enforces checkout bounds', () => {
  expect(parseAimlapiAmountUsd(undefined)).toBe(2500)
  expect(parseAimlapiAmountUsd('20')).toBe(2000)
  expect(parseAimlapiAmountUsd('25.25')).toBe(2525)
  expect(parseAimlapiAmountUsd('10000')).toBe(1_000_000)
  expect(() => parseAimlapiAmountUsd('19.99')).toThrow('Minimum top-up is $20')
  expect(() => parseAimlapiAmountUsd('10000.01')).toThrow('Maximum top-up is $10000')
  expect(() => parseAimlapiAmountUsd('19.999')).toThrow('Pass a valid USD amount')
  expect(() => parseAimlapiAmountUsd('10000.004')).toThrow('Pass a valid USD amount')
  expect(() => parseAimlapiAmountUsd('nope')).toThrow('Pass a positive number of USD')
  expect(() => parseAimlapiAmountUsd('Infinity')).toThrow('Pass a positive number of USD')
})

test('isValidAimlapiEmail rejects incomplete domains', () => {
  expect(isValidAimlapiEmail('user@example.com')).toBe(true)
  expect(isValidAimlapiEmail('user@example')).toBe(false)
  expect(isValidAimlapiEmail('user@example.c')).toBe(false)
  expect(isValidAimlapiEmail('user@.example.com')).toBe(false)
})

test('topUpAimlapiByApiKey funds the key account without exchange', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method} ${url}`)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return Response.json({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test' },
        partnerCheckout: { sessionToken: 'session', status: 'pending_payment' },
      })
    }
    if (url.endsWith('/v3/partner-checkout/sessions/session')) {
      return Response.json({ sessionToken: 'session', status: 'paid' })
    }
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch

  const sessions: string[] = []
  const result = await topUpAimlapiByApiKey({
    apiKey: 'key_test',
    paymentSessionId: 'payment-id',
    amountUsd: '25',
    noOpen: true,
    onSession: session => sessions.push(session),
  })

  expect(result.apiKey).toBe('key_test')
  expect(sessions).toEqual(['session'])
  expect(calls).toEqual([
    'POST https://app.example.test/v3/partner-checkout/sessions',
    'POST https://api.example.test/v2/billing/topup',
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
  expect(calls.some(call => call.endsWith('/exchange'))).toBe(false)
})

test('topUpAimlapiByApiKey resumes a paid session without charging again', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`)
    return Response.json({ sessionToken: 'session', status: 'paid' })
  }) as unknown as typeof fetch

  await topUpAimlapiByApiKey({
    apiKey: 'key_test',
    paymentSessionId: 'payment-id',
    resumeSessionToken: 'session',
    amountUsd: '25',
    noOpen: true,
  })

  expect(calls).toEqual([
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
})

test('a pending resumed session is polled without paying again', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  const calls: string[] = []
  let reads = 0
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`)
    reads += 1
    return Response.json({
      sessionToken: 'session',
      status: reads === 1 ? 'pending_payment' : 'paid',
    })
  }) as unknown as typeof fetch

  await topUpAimlapiByApiKey({
    apiKey: 'key_test',
    paymentSessionId: 'payment-id',
    resumeSessionToken: 'session',
    amountUsd: '25',
    noOpen: true,
  })

  expect(calls).toEqual([
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
})

test('provisionAimlapiKey does not repeat an already completed exchange', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`)
    return Response.json({ sessionToken: 'session', status: 'exchanged' })
  }) as unknown as typeof fetch

  await expect(
    provisionAimlapiKey({
      sessionToken: 'account-session',
      resumeSessionToken: 'session',
      paymentSessionId: 'payment-id',
      exchange: true,
      amountUsd: '25',
      noOpen: true,
    }),
  ).rejects.toThrow('Session was already exchanged')

  expect(calls).toEqual([
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
})

test('an in-progress exchange is observed without issuing a second exchange', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  const calls: string[] = []
  let reads = 0
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`)
    reads += 1
    return Response.json({
      sessionToken: 'session',
      status: reads === 1 ? 'exchanging' : 'exchanged',
    })
  }) as unknown as typeof fetch

  await expect(
    provisionAimlapiKey({
      sessionToken: 'account-session',
      resumeSessionToken: 'session',
      paymentSessionId: 'payment-id',
      exchange: true,
      amountUsd: '25',
      noOpen: true,
    }),
  ).rejects.toThrow('Session was already exchanged')
  expect(calls.every(call => call.startsWith('GET '))).toBe(true)
})

test('email-session checkout carries the stable payment id', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'
  let payBody: Record<string, unknown> | undefined
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return Response.json({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/pay')) {
      payBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { sessionToken: 'session', status: 'pending_payment' },
      })
    }
    return Response.json({ sessionToken: 'session', status: 'paid' })
  }) as unknown as typeof fetch

  await provisionAimlapiKey({
    sessionToken: 'account-session',
    paymentSessionId: 'stable-payment-id',
    exchange: false,
    existingApiKey: 'key_test',
    amountUsd: '25',
    noOpen: true,
  })

  expect(payBody?.paymentSessionId).toBe('stable-payment-id')
})

test('checkout URL must be an absolute credential-free HTTPS URL', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return Response.json({ sessionToken: 'session', status: 'pending_auth' })
    }
    return Response.json({
      checkout: { providerSessionId: 'provider', payUrl: 'file:///tmp/checkout' },
      partnerCheckout: { sessionToken: 'session', status: 'pending_payment' },
    })
  }) as unknown as typeof fetch

  await expect(
    topUpAimlapiByApiKey({
      apiKey: 'key_test',
      paymentSessionId: 'payment-id',
      amountUsd: '25',
      noOpen: true,
    }),
  ).rejects.toThrow('valid HTTPS checkout URL')
})

test('terminal resumed-session errors clear retained checkout state', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  globalThis.fetch = mock(async () => new Response('gone', { status: 404 })) as unknown as typeof fetch
  const sessions: string[] = []

  await expect(
    topUpAimlapiByApiKey({
      apiKey: 'key_test',
      paymentSessionId: 'payment-id',
      resumeSessionToken: 'dead-session',
      amountUsd: '25',
      noOpen: true,
      onSession: session => sessions.push(session),
    }),
  ).rejects.toThrow('404')
  expect(sessions).toEqual([''])
})

test('dead sessions observed while polling are cleared immediately', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return Response.json({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { sessionToken: 'session', status: 'pending_payment' },
      })
    }
    return Response.json({ sessionToken: 'session', status: 'expired' })
  }) as unknown as typeof fetch
  const sessions: string[] = []

  await expect(
    topUpAimlapiByApiKey({
      apiKey: 'key_test',
      paymentSessionId: 'payment-id',
      amountUsd: '25',
      noOpen: true,
      onSession: session => sessions.push(session),
    }),
  ).rejects.toThrow('Payment expired')
  expect(sessions).toEqual(['session', ''])
})

test('terminal API errors observed while polling clear retained checkout state', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return Response.json({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { sessionToken: 'session', status: 'pending_payment' },
      })
    }
    return new Response('gone', { status: 410 })
  }) as unknown as typeof fetch
  const sessions: string[] = []

  await expect(
    topUpAimlapiByApiKey({
      apiKey: 'key_test',
      paymentSessionId: 'payment-id',
      amountUsd: '25',
      noOpen: true,
      onSession: session => sessions.push(session),
    }),
  ).rejects.toThrow('410')
  expect(sessions).toEqual(['session', ''])
})

test('polling retries a transient transport failure', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  let attempts = 0
  globalThis.fetch = mock(async () => {
    attempts += 1
    if (attempts === 1) throw new TypeError('temporary connection reset')
    return Response.json({ sessionToken: 'session', status: 'paid' })
  }) as unknown as typeof fetch
  const client = new AimlapiClient({
    authBaseUrl: 'https://auth.example.test',
    appBaseUrl: 'https://app.example.test',
    inferenceBaseUrl: 'https://api.example.test/v1',
    payBaseUrl: 'https://pay.example.test',
    verificationBaseUrl: 'https://front.example.test',
  })

  await expect(pollUntilPaid(client, 'session')).resolves.toEqual(
    expect.objectContaining({ status: 'paid' }),
  )
  expect(attempts).toBe(2)
})

test('polling retains and retries the same session after a rate limit', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  let attempts = 0
  globalThis.fetch = mock(async () => {
    attempts += 1
    if (attempts === 1) return new Response('rate limited', { status: 429 })
    return Response.json({ sessionToken: 'session', status: 'paid' })
  }) as unknown as typeof fetch
  const client = new AimlapiClient({
    authBaseUrl: 'https://auth.example.test',
    appBaseUrl: 'https://app.example.test',
    inferenceBaseUrl: 'https://api.example.test/v1',
    payBaseUrl: 'https://pay.example.test',
    verificationBaseUrl: 'https://front.example.test',
  })
  const sessions: string[] = []

  await expect(
    pollUntilPaid(client, 'session', undefined, value => sessions.push(value)),
  ).resolves.toEqual(expect.objectContaining({ status: 'paid' }))
  expect(attempts).toBe(2)
  expect(sessions).toEqual([])
})

test('by-key billing stays on the endpoint that validated the key', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://override.example.test/v1'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return Response.json({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { sessionToken: 'session', status: 'pending_payment' },
      })
    }
    return Response.json({ sessionToken: 'session', status: 'paid' })
  }) as unknown as typeof fetch

  await topUpAimlapiByApiKey({
    apiKey: 'production-key',
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    paymentSessionId: 'payment-id',
    amountUsd: '25',
    noOpen: true,
  })
  expect(calls).toContain('https://api.aimlapi.com/v2/billing/topup')
  expect(calls).not.toContain('https://override.example.test/v2/billing/topup')
})

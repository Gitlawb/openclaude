import { afterAll, afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import * as realTopupDependencies from './topupDependencies.js'
import { saveAimlapiTopupState } from './topupState.js'
import { isValidAimlapiEmail, parseAimlapiAmountUsd } from './validation.js'

mock.module('./topupDependencies.js', () => ({
  openBrowser: async () => {},
  saveProfileFile: () => 'profile.json',
  promptText: async () => '',
}))
const { pollUntilPaid, provisionAimlapiKey, runAimlapiTopup, topUpAimlapiByApiKey } =
  await import('./topup.js')
const { AimlapiClient } = await import('./client.js')

const originalFetch = globalThis.fetch
const originalEnv = {
  AIMLAPI_AUTH_URL: process.env.AIMLAPI_AUTH_URL,
  AIMLAPI_APP_URL: process.env.AIMLAPI_APP_URL,
  AIMLAPI_INFERENCE_URL: process.env.AIMLAPI_INFERENCE_URL,
  AIMLAPI_PAY_URL: process.env.AIMLAPI_PAY_URL,
}
const temporaryDirectories: string[] = []

afterAll(() => {
  mock.module('./topupDependencies.js', () => realTopupDependencies)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setClaudeConfigHomeDirForTesting(undefined)
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
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

test('CLI retries reuse the persisted checkout session and payment id', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'

  let accountChecks = 0
  const payBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/auth/account')) {
      accountChecks += 1
      return Response.json({ action: accountChecks === 1 ? 'sign-up' : 'sign-in' })
    }
    if (url.endsWith('/passwordless')) {
      return Response.json({ token: 'account-token-one', exp: 1 })
    }
    if (url.endsWith('/sign-in/code')) return new Response(null, { status: 204 })
    if (url.endsWith('/code/verify')) {
      return Response.json({ token: 'account-token-two', exp: 2 })
    }
    if (url.endsWith('/v1/keys')) {
      return Response.json({ key: 'key_test', id: 'key_id' })
    }
    if (url.endsWith('/v3/partner-checkout/sessions') && init?.method === 'POST') {
      return Response.json({ sessionToken: 'checkout-session', status: 'pending_auth' })
    }
    if (url.endsWith('/pay')) {
      payBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      throw new Error('ambiguous payment response')
    }
    if (url.endsWith('/v3/partner-checkout/sessions/checkout-session')) {
      return Response.json({ sessionToken: 'checkout-session', status: 'paid' })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  await expect(
    runAimlapiTopup({ email: 'user@example.com', amountUsd: '25', noOpen: true }),
  ).rejects.toThrow('ambiguous payment response')

  const saved = JSON.parse(
    readFileSync(join(configDirectory, 'aimlapi-topup.json'), 'utf8'),
  ) as { paymentSessionId: string; resumeSessionToken: string }
  expect(saved.paymentSessionId).toBeTruthy()
  expect(saved.resumeSessionToken).toBe('checkout-session')
  expect(payBodies).toHaveLength(1)
  expect(payBodies[0]?.paymentSessionId).toBe(saved.paymentSessionId)

  await runAimlapiTopup({
    email: 'user@example.com',
    code: '123456',
    amountUsd: '25',
    noOpen: true,
  })
  expect(payBodies).toHaveLength(1)
  expect(() => readFileSync(join(configDirectory, 'aimlapi-topup.json'))).toThrow()
})

test('CLI retains an already-exchanged checkout and blocks identical retries', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'
  saveAimlapiTopupState({
    email: 'user@example.com',
    amountUsdMinor: 2500,
    autoTopUp: false,
    partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
    partnerName: 'Gitlawb',
    appBaseUrl: 'https://app.example.test',
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    payBaseUrl: 'https://pay.example.test',
    verificationBaseUrl: 'https://aimlapi.com/app',
    paymentSessionId: 'persisted-payment',
    resumeSessionToken: 'exchanged-session',
  })

  let sessionReads = 0
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v1/auth/account')) return Response.json({ action: 'sign-in' })
    if (url.endsWith('/sign-in/code')) return new Response(null, { status: 204 })
    if (url.endsWith('/code/verify')) {
      return Response.json({ token: 'account-token', exp: 1 })
    }
    if (url.endsWith('/v1/keys')) {
      return Response.json({ key: 'key_test', id: 'created-key' })
    }
    if (url.endsWith('/sessions/exchanged-session')) {
      sessionReads += 1
      return Response.json({
        sessionToken: 'exchanged-session',
        status: 'exchanged',
        issuedKeyId: 'issued-key-id',
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  const retry = (): Promise<void> =>
    runAimlapiTopup({
      email: 'user@example.com',
      code: '123456',
      amountUsd: '25',
      noOpen: true,
    })

  await expect(retry()).rejects.toThrow('issued key issued-key-id')
  await expect(retry()).rejects.toThrow('issued key issued-key-id')
  expect(sessionReads).toBe(2)
  expect(
    JSON.parse(readFileSync(join(configDirectory, 'aimlapi-topup.json'), 'utf8')),
  ).toMatchObject({
    paymentSessionId: 'persisted-payment',
    resumeSessionToken: 'exchanged-session',
  })
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
    return Response.json({
      sessionToken: 'session',
      status: 'exchanged',
      issuedKeyId: 'key_recoverable',
    })
  }) as unknown as typeof fetch
  const sessions: string[] = []

  await expect(
    provisionAimlapiKey({
      sessionToken: 'account-session',
      resumeSessionToken: 'session',
      paymentSessionId: 'payment-id',
      exchange: true,
      amountUsd: '25',
      noOpen: true,
      onSession: session => sessions.push(session),
    }),
  ).rejects.toThrow('issued key key_recoverable')

  expect(calls).toEqual([
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
  expect(sessions).toEqual([])
})

test('an in-progress exchange is observed without issuing a second exchange', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  const calls: string[] = []
  let reads = 0
  const sessions: string[] = []
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
      onSession: session => sessions.push(session),
    }),
  ).rejects.toThrow('Session was already exchanged')
  expect(calls.every(call => call.startsWith('GET '))).toBe(true)
  expect(sessions).toEqual(['session'])
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

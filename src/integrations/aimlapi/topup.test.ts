import { afterAll, afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import {
  claimAimlapiTopupState,
  loadAimlapiTopupState,
  recordAimlapiSettledKeyAsync,
  saveAimlapiTopupState,
} from './topupState.js'
import { isValidAimlapiEmail, parseAimlapiAmountUsd } from './validation.js'
import {
  pollUntilPaid,
  provisionAimlapiKey,
  runAimlapiTopup,
  setAimlapiTopupTestDoubles,
  topUpAimlapiByApiKey,
  type AimlapiTopupStatus,
} from './topup.js'
import { AimlapiClient } from './client.js'

let lastSavedProfileEnv: Record<string, unknown> | undefined
// Inject the profile writer + prompt stubs through the module's own DI seam
// rather than a process-global `mock.module` (which leaks across test files in
// this repo). The transport is stubbed per-test via `globalThis.fetch`.
setAimlapiTopupTestDoubles({
  writeProfile: options => {
    lastSavedProfileEnv = options.env as Record<string, unknown>
    return 'profile.json'
  },
  promptText: async () => '',
  promptHidden: async () => '',
})

// createSession/getSession responses are validated against the full
// PartnerCheckoutSession contract, so mocks must carry id + partnerId too.
function sessionJson(session: Record<string, unknown>): Response {
  // The current client validates the full PartnerCheckoutSession contract,
  // including the nullable-but-required fields, so carry them as null.
  return Response.json({
    id: 'sess_test',
    partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
    partnerName: null,
    userId: null,
    amountUsdMinor: null,
    issuedKeyId: null,
    returnUrl: null,
    ...session,
  })
}

const originalFetch = globalThis.fetch
const originalEnv = {
  AIMLAPI_AUTH_URL: process.env.AIMLAPI_AUTH_URL,
  AIMLAPI_APP_URL: process.env.AIMLAPI_APP_URL,
  AIMLAPI_INFERENCE_URL: process.env.AIMLAPI_INFERENCE_URL,
  AIMLAPI_PAY_URL: process.env.AIMLAPI_PAY_URL,
  AIMLAPI_PARTNER_ID: process.env.AIMLAPI_PARTNER_ID,
  AIMLAPI_VERIFICATION_BASE_URL: process.env.AIMLAPI_VERIFICATION_BASE_URL,
  AIMLAPI_RETURN_URL: process.env.AIMLAPI_RETURN_URL,
  AIMLAPI_EMAIL: process.env.AIMLAPI_EMAIL,
  AIMLAPI_CODE: process.env.AIMLAPI_CODE,
}
const temporaryDirectories: string[] = []

afterAll(() => {
  setAimlapiTopupTestDoubles(undefined)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  lastSavedProfileEnv = undefined
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
  // Scientific notation must not slip sub-cent precision past the rounding.
  expect(() => parseAimlapiAmountUsd('20.001e0')).toThrow('Pass a valid USD amount')
  expect(() => parseAimlapiAmountUsd('2.0001e1')).toThrow('Pass a valid USD amount')
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
      return sessionJson({ sessionToken: 'checkout-session', status: 'pending_auth' })
    }
    if (url.endsWith('/pay')) {
      payBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      throw new Error('ambiguous payment response')
    }
    if (url.endsWith('/exchange')) {
      // The retry exchanges the paid sign-up session (the first attempt's pay
      // response was ambiguous but the session is now paid) instead of minting an
      // unrelated key.
      return Response.json({ apiKey: 'exchanged_key', apiKeyId: 'exchanged_id' })
    }
    if (url.endsWith('/v3/partner-checkout/sessions/checkout-session')) {
      return sessionJson({ sessionToken: 'checkout-session', status: 'paid' })
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

test('sign-in adopts a peer-recorded key instead of minting a second one', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'
  const statePath = join(configDirectory, 'aimlapi-topup.json')

  let keyMints = 0
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/auth/account')) return Response.json({ action: 'sign-in' })
    if (url.endsWith('/sign-in/code')) return new Response(null, { status: 204 })
    if (url.endsWith('/code/verify')) {
      // This process already claimed (synchronously, before the first await)
      // and its own in-memory checkoutState.apiKey is still empty. A peer
      // running the SAME intent races ahead and records its own key during
      // this await gap — matching this exact record's intent + payment id,
      // read back off disk since paymentSessionId is a fresh random UUID.
      const claimedState = JSON.parse(readFileSync(statePath, 'utf8'))
      saveAimlapiTopupState({ ...claimedState, apiKey: 'peer-key', apiKeyId: 'peer-id' })
      return Response.json({ token: 'account-token', exp: 1 })
    }
    if (url.endsWith('/v1/keys')) {
      keyMints += 1
      return Response.json({ key: 'minted-key', id: 'minted-id' })
    }
    if (url.endsWith('/v3/partner-checkout/sessions') && init?.method === 'POST') {
      return sessionJson({ sessionToken: 'checkout-session', status: 'pending_auth' })
    }
    // Fail right after the retained-key check — full payment settlement is
    // not what's under test here.
    if (url.endsWith('/pay')) throw new Error('ambiguous payment response')
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  await expect(
    runAimlapiTopup({ email: 'user@example.com', code: '123456', amountUsd: '25', noOpen: true }),
  ).rejects.toThrow('ambiguous payment response')

  // The peer's key was adopted — this process never minted its own.
  expect(keyMints).toBe(0)
  const saved = JSON.parse(readFileSync(statePath, 'utf8')) as {
    apiKey: string
    apiKeyId: string
  }
  expect(saved.apiKey).toBe('peer-key')
  expect(saved.apiKeyId).toBe('peer-id')
})

test('a successful exchange persists the settled receipt before returning it', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-exch-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'

  const intent = {
    email: 'user@example.com',
    amountUsdMinor: 2500,
    autoTopUp: false,
    partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
    partnerName: 'OpenClaude',
    appBaseUrl: 'https://app.example.test',
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    payBaseUrl: 'https://pay.example.test',
    verificationBaseUrl: 'https://front.example.test',
  }
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'paid-session',
  })

  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions/paid-session')) {
      return sessionJson({ sessionToken: 'paid-session', status: 'paid' })
    }
    if (url.endsWith('/exchange')) {
      return Response.json({ apiKey: 'exchanged_key', apiKeyId: 'exchanged_id' })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  const provisioned = await provisionAimlapiKey({
    sessionToken: 'account-session',
    resumeSessionToken: 'paid-session',
    paymentSessionId: claimed.paymentSessionId,
    exchange: true,
    intent,
    amountUsd: '25',
    model: 'gpt-4o',
    noOpen: true,
  })
  expect(provisioned.apiKey).toBe('exchanged_key')

  // The one-shot /exchange is non-idempotent, so exchangeKeyWithLease records the
  // settled receipt under the CAS BEFORE returning: an interruption before the
  // caller's own profile/receipt write still recovers the paid key rather than
  // re-running (and being rejected by) the spent exchange.
  const saved = loadAimlapiTopupState(intent)
  expect(saved?.settled).toBe(true)
  expect(saved?.apiKey).toBe('exchanged_key')
  expect(saved?.apiKeyId).toBe('exchanged_id')
})

test('a sibling that cleared the checkout aborts instead of paying twice', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'

  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method} ${url}`)
    if (url.endsWith('/v1/auth/account')) return Response.json({ action: 'sign-up' })
    if (url.endsWith('/passwordless')) return Response.json({ token: 'session', exp: 1 })
    if (url.endsWith('/v3/partner-checkout/sessions') && init?.method === 'POST') {
      // Simulate a concurrent sibling that finished and cleared this exact
      // top-up between our claim and our session-election write.
      rmSync(join(configDirectory, 'aimlapi-topup.json'), { force: true })
      return sessionJson({ sessionToken: 'checkout-session', status: 'pending_auth' })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  await expect(
    runAimlapiTopup({ email: 'new@example.com', amountUsd: '25', noOpen: true }),
  ).rejects.toThrow(/already completed or cancelled/i)
  // The election aborts before any /pay call — no second charge is opened.
  expect(calls.some(call => call.endsWith('/pay'))).toBe(false)
})

test('CLI retains an already-exchanged checkout and blocks identical retries', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'
  const persisted = claimAimlapiTopupState({
    email: 'user@example.com',
    amountUsdMinor: 2500,
    autoTopUp: false,
    partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
    partnerName: 'Gitlawb',
    appBaseUrl: 'https://app.example.test',
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    payBaseUrl: 'https://pay.example.test',
    verificationBaseUrl: 'https://aimlapi.com/app',
  })
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
    paymentSessionId: persisted.paymentSessionId,
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
      return sessionJson({
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
    paymentSessionId: persisted.paymentSessionId,
    resumeSessionToken: 'exchanged-session',
  })
})

test('a failed payment retains the issued key for the next run', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'
  // Keep the canonical inference URL so the guided-provisioning gate allows the
  // run; the flow uses the app/auth/pay hosts for its requests.

  let keyMints = 0
  let sessionStatus = 'expired'
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/auth/account')) return Response.json({ action: 'sign-in' })
    if (url.endsWith('/sign-in/code')) return new Response(null, { status: 204 })
    if (url.endsWith('/code/verify')) return Response.json({ token: 'account-token', exp: 1 })
    if (url.endsWith('/v1/keys')) {
      keyMints += 1
      return Response.json({ key: 'key_test', id: 'key_id' })
    }
    if (url.endsWith('/v3/partner-checkout/sessions') && init?.method === 'POST') {
      return sessionJson({ sessionToken: 'checkout-session', status: 'pending_auth' })
    }
    if (url.endsWith('/pay')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { id: 'sess_test', partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ', partnerName: null, userId: null, amountUsdMinor: null, issuedKeyId: null, returnUrl: null, sessionToken: 'checkout-session', status: 'pending_payment' },
      })
    }
    if (url.endsWith('/v3/partner-checkout/sessions/checkout-session')) {
      return sessionJson({ sessionToken: 'checkout-session', status: sessionStatus })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  // First run: the payment expires. The issued key must survive the terminal reset.
  await expect(
    runAimlapiTopup({ email: 'user@example.com', code: '123456', amountUsd: '25', noOpen: true }),
  ).rejects.toThrow('Payment expired')

  const afterFailure = JSON.parse(
    readFileSync(join(configDirectory, 'aimlapi-topup.json'), 'utf8'),
  ) as { apiKey?: string; resumeSessionToken: string }
  expect(afterFailure.apiKey).toBe('key_test')
  expect(afterFailure.resumeSessionToken).toBe('')
  expect(keyMints).toBe(1)

  // Second run: the payment clears and the retained key is reused (not re-minted).
  sessionStatus = 'paid'
  await runAimlapiTopup({
    email: 'user@example.com',
    code: '123456',
    amountUsd: '25',
    noOpen: true,
  })
  expect(keyMints).toBe(1)
  expect(() => readFileSync(join(configDirectory, 'aimlapi-topup.json'))).toThrow()
})

test('the CLI refuses guided top-up on a non-canonical inference endpoint', async () => {
  process.env.AIMLAPI_INFERENCE_URL = 'https://proxy.example.test/v1'
  let fetched = false
  globalThis.fetch = mock(async () => {
    fetched = true
    return Response.json({})
  }) as unknown as typeof fetch

  await expect(
    runAimlapiTopup({ email: 'user@example.com', amountUsd: '25', noOpen: true }),
  ).rejects.toThrow('production endpoint')
  // Rejected before any account lookup or key mint.
  expect(fetched).toBe(false)
})

test('a settled interrupted run resumes the profile write without re-provisioning', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  const intent = {
    email: 'user@example.com',
    amountUsdMinor: 2500,
    autoTopUp: false,
    partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
    partnerName: 'Gitlawb',
    appBaseUrl: 'https://app.aimlapi.com',
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    payBaseUrl: 'https://pay.aimlapi.com',
    verificationBaseUrl: 'https://aimlapi.com/app',
  }
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'checkout-session',
    apiKey: 'exchanged-key',
    apiKeyId: 'exchanged-id',
    // Original run provisioned a non-default model.
    model: 'anthropic/claude-opus-4-8',
    settled: true,
  })

  let fetched = false
  globalThis.fetch = mock(async () => {
    fetched = true
    return Response.json({})
  }) as unknown as typeof fetch

  // Retry without --model: the default would be gpt-4o, but the settled receipt
  // must win.
  await runAimlapiTopup({ email: 'user@example.com', amountUsd: '25', noOpen: true })

  // The retained settled key finished the write — no account check/provisioning,
  // the persisted model is preserved, and the checkout state is cleared.
  expect(fetched).toBe(false)
  expect(lastSavedProfileEnv?.OPENAI_API_KEY).toBe('exchanged-key')
  expect(lastSavedProfileEnv?.OPENAI_MODEL).toBe('anthropic/claude-opus-4-8')
  expect(() => readFileSync(join(configDirectory, 'aimlapi-topup.json'))).toThrow()
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
      return sessionJson({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test' },
        partnerCheckout: { id: 'sess_test', partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ', partnerName: null, userId: null, amountUsdMinor: null, issuedKeyId: null, returnUrl: null, sessionToken: 'session', status: 'pending_payment' },
      })
    }
    if (url.endsWith('/v3/partner-checkout/sessions/session')) {
      return sessionJson({ sessionToken: 'session', status: 'paid' })
    }
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch

  const sessions: string[] = []
  const result = await topUpAimlapiByApiKey({
    apiKey: 'key_test',
    paymentSessionId: 'payment-id',
    amountUsd: '25',
    noOpen: true,
    onSession: session => {
      sessions.push(session)
    },
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
    return sessionJson({ sessionToken: 'session', status: 'paid' })
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

test('a pending resumed session re-issues the idempotent checkout to recover the URL', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  const topupBodies: Array<Record<string, unknown>> = []
  let reads = 0
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v2/billing/topup')) {
      topupBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: {
          id: 'sess_test',
          partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
          partnerName: null,
          userId: null,
          amountUsdMinor: null,
          issuedKeyId: null,
          returnUrl: null,
          sessionToken: 'session',
          status: 'pending_payment',
        },
      })
    }
    reads += 1
    return sessionJson({
      sessionToken: 'session',
      status: reads === 1 ? 'pending_payment' : 'paid',
    })
  }) as unknown as typeof fetch

  const statuses: AimlapiTopupStatus[] = []
  await topUpAimlapiByApiKey({
    apiKey: 'key_test',
    paymentSessionId: 'payment-id',
    resumeSessionToken: 'session',
    amountUsd: '25',
    noOpen: true,
    onStatus: status => {
      statuses.push(status)
    },
  })

  // A pending_payment resume re-issues the idempotent top-up (SAME paymentSessionId
  // — no double charge) to recover the lost checkout URL, then polls to paid.
  expect(topupBodies).toHaveLength(1)
  expect(topupBodies[0]?.paymentSessionId).toBe('payment-id')
  expect(statuses).toContain('opening-checkout')
})

test('a resumed by-key session still exchanging settles before success', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  const calls: string[] = []
  let reads = 0
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`)
    reads += 1
    return sessionJson({
      sessionToken: 'session',
      status: reads === 1 ? 'exchanging' : 'exchanged',
    })
  }) as unknown as typeof fetch

  const result = await topUpAimlapiByApiKey({
    apiKey: 'key_test',
    paymentSessionId: 'payment-id',
    resumeSessionToken: 'session',
    amountUsd: '25',
    noOpen: true,
  })

  expect(result.apiKey).toBe('key_test')
  // The first GET resolves the resumed session (exchanging); the settle poll
  // then waits for it to reach exchanged instead of reporting success early.
  expect(calls).toEqual([
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
})

test('a resumed sign-in top-up settles before returning the existing key', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  const calls: string[] = []
  let reads = 0
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`)
    reads += 1
    return sessionJson({
      sessionToken: 'session',
      status: reads === 1 ? 'exchanging' : 'exchanged',
    })
  }) as unknown as typeof fetch

  const result = await provisionAimlapiKey({
    exchange: false,
    existingApiKey: 'existing_key',
    existingApiKeyId: 'existing_id',
    sessionToken: 'session',
    resumeSessionToken: 'session',
    paymentSessionId: 'payment-id',
    amountUsd: '25',
    noOpen: true,
  })

  expect(result.apiKey).toBe('existing_key')
  // The account (non-exchange) resume path mirrors the by-key flow: the first GET
  // resolves the resumed session (exchanging); the settle poll then waits for it
  // to reach a terminal state instead of reporting the balance credited early.
  expect(calls).toEqual([
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
})

test('an invalid amount is rejected before any key is minted', async () => {
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/v1/auth/account')) return Response.json({ action: 'sign-in' })
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  await expect(
    runAimlapiTopup({
      email: 'user@example.com',
      code: '123456',
      amountUsd: '5',
      noOpen: true,
    }),
  ).rejects.toThrow('Minimum top-up is $20')
  expect(calls.some(call => call.endsWith('/v1/keys'))).toBe(false)
  expect(calls.some(call => call.endsWith('/sign-in/code'))).toBe(false)
})

test('an unsupported account action is rejected without provisioning', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_AUTH_URL = 'https://auth.example.test'
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/v1/auth/account')) return Response.json({ action: 'reset' })
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch

  // The client validates the account action at the boundary and fails closed on
  // an unknown one, so the flow never reaches its own unsupported-action guard.
  await expect(
    runAimlapiTopup({ email: 'user@example.com', amountUsd: '25', noOpen: true }),
  ).rejects.toThrow(/invalid account response/i)
  expect(calls.some(call => call.endsWith('/passwordless'))).toBe(false)
  expect(calls.some(call => call.endsWith('/v1/keys'))).toBe(false)
})

test('provisionAimlapiKey does not repeat an already completed exchange', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  const calls: string[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`)
    return sessionJson({
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
      onSession: session => {
      sessions.push(session)
    },
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
    return sessionJson({
      sessionToken: 'session',
      status: reads === 1 ? 'exchanging' : 'exchanged',
    })
  }) as unknown as typeof fetch

  // `sessionToken` (the passwordless-auth bearer) is deliberately different from
  // `resumeSessionToken` (the checkout token) so a poll that mixed them up would
  // request the wrong resource and be caught below.
  await expect(
    provisionAimlapiKey({
      sessionToken: 'account-session',
      resumeSessionToken: 'session',
      paymentSessionId: 'payment-id',
      exchange: true,
      amountUsd: '25',
      noOpen: true,
      onSession: session => {
      sessions.push(session)
    },
    }),
  ).rejects.toThrow('Session was already exchanged')
  // The resolve read and the settle-poll read must both target the checkout
  // token's session resource, never the auth bearer.
  expect(calls).toEqual([
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
    'GET https://app.example.test/v3/partner-checkout/sessions/session',
  ])
  expect(sessions).toEqual(['session'])
})

test('a peer settling mid-wait is resumed from instead of hard-failing the exchange', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'

  const intent = {
    email: 'user@example.com',
    amountUsdMinor: 2500,
    autoTopUp: false,
    partnerId: 'part_test',
    partnerName: 'Gitlawb',
    appBaseUrl: 'https://app.example.test',
    inferenceBaseUrl: 'https://api.example.test/v1',
    payBaseUrl: 'https://pay.example.test',
    verificationBaseUrl: 'https://front.example.test',
  }
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  let reads = 0
  globalThis.fetch = mock(async () => {
    reads += 1
    if (reads === 1) {
      // resolveTopupSession's resume read: still exchanging → wait-exchange.
      return sessionJson({ sessionToken: 'session', status: 'exchanging' })
    }
    // pollUntilExchangeSettled's read: by the time this lands, a PEER process
    // has already finished /exchange and recorded the settled key — simulated
    // here as a side effect of the same request racing that write.
    await recordAimlapiSettledKeyAsync(expected, {
      apiKey: 'peer-exchanged-key',
      apiKeyId: 'peer-exchanged-id',
    })
    return sessionJson({ sessionToken: 'session', status: 'exchanged' })
  }) as unknown as typeof fetch

  const result = await provisionAimlapiKey({
    sessionToken: 'account-session',
    resumeSessionToken: 'session',
    paymentSessionId: claimed.paymentSessionId,
    exchange: true,
    intent,
    amountUsd: '25',
    noOpen: true,
  })

  // Resumed from the peer's settled receipt instead of throwing "Session was
  // already exchanged".
  expect(result.apiKey).toBe('peer-exchanged-key')
  expect(result.apiKeyId).toBe('peer-exchanged-id')
})

test('a lease reclaimed mid-wait stops the poll instead of racing the peer to /exchange', async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-cli-'))
  temporaryDirectories.push(configDirectory)
  setClaudeConfigHomeDirForTesting(configDirectory)
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'

  const intent = {
    email: 'user@example.com',
    amountUsdMinor: 2500,
    autoTopUp: false,
    partnerId: 'part_test',
    partnerName: 'Gitlawb',
    appBaseUrl: 'https://app.example.test',
    inferenceBaseUrl: 'https://api.example.test/v1',
    payBaseUrl: 'https://pay.example.test',
    verificationBaseUrl: 'https://front.example.test',
  }
  const claimed = claimAimlapiTopupState(intent)
  const statePath = join(configDirectory, 'aimlapi-topup.json')

  let reads = 0
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    reads += 1
    if (reads === 1) {
      // resolveTopupSession's resume read: still exchanging → wait-exchange.
      // This process now acquires the exchange lease.
      return sessionJson({ sessionToken: 'session', status: 'exchanging' })
    }
    if (reads === 2) {
      // The poll's first read: still exchanging, so it loops again. A PEER
      // reclaims the lease right here, between this read and the poll's next
      // refresh — simulated by overwriting the owner directly on disk.
      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      state.exchangeLeaseOwner = 'peer-owner'
      state.exchangeLeaseAt = Date.now()
      writeFileSync(statePath, JSON.stringify(state))
      return sessionJson({ sessionToken: 'session', status: 'exchanging' })
    }
    // The peer hasn't finished yet (no settled receipt), so the recovery
    // recheck in exchangeKeyWithLease's catch also finds nothing to resume
    // from. A THIRD read (or a call to POST /exchange) means the lease loss
    // went undetected and this process raced the peer to the one-shot POST.
    throw new Error(`Unexpected further request: ${init?.method ?? 'GET'} (read ${reads})`)
  }) as unknown as typeof fetch

  await expect(
    provisionAimlapiKey({
      sessionToken: 'account-session',
      resumeSessionToken: 'session',
      paymentSessionId: claimed.paymentSessionId,
      exchange: true,
      intent,
      amountUsd: '25',
      noOpen: true,
    }),
  ).rejects.toThrow(/reclaimed by another process/i)
  expect(reads).toBe(2)
}, 10_000)

test('email-session checkout carries the stable payment id', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_PAY_URL = 'https://pay.example.test'
  let payBody: Record<string, unknown> | undefined
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return sessionJson({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/pay')) {
      payBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { id: 'sess_test', partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ', partnerName: null, userId: null, amountUsdMinor: null, issuedKeyId: null, returnUrl: null, sessionToken: 'session', status: 'pending_payment' },
      })
    }
    return sessionJson({ sessionToken: 'session', status: 'paid' })
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
      return sessionJson({ sessionToken: 'session', status: 'pending_auth' })
    }
    return Response.json({
      checkout: { providerSessionId: 'provider', payUrl: 'https://user:pass@checkout.test/pay' },
      partnerCheckout: { id: 'sess_test', partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ', partnerName: null, userId: null, amountUsdMinor: null, issuedKeyId: null, returnUrl: null, sessionToken: 'session', status: 'pending_payment' },
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
      onSession: session => {
      sessions.push(session)
    },
    }),
  ).rejects.toThrow('404')
  expect(sessions).toEqual([''])
})

test('dead sessions observed while polling are cleared immediately', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return sessionJson({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { id: 'sess_test', partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ', partnerName: null, userId: null, amountUsdMinor: null, issuedKeyId: null, returnUrl: null, sessionToken: 'session', status: 'pending_payment' },
      })
    }
    return sessionJson({ sessionToken: 'session', status: 'expired' })
  }) as unknown as typeof fetch
  const sessions: string[] = []

  await expect(
    topUpAimlapiByApiKey({
      apiKey: 'key_test',
      paymentSessionId: 'payment-id',
      amountUsd: '25',
      noOpen: true,
      onSession: session => {
      sessions.push(session)
    },
    }),
  ).rejects.toThrow('Payment expired')
  expect(sessions).toEqual(['session', ''])
})

test('aborting during polling stops requests and preserves the retained session', async () => {
  const controller = new AbortController()
  let getCount = 0
  globalThis.fetch = mock(async () => {
    getCount += 1
    controller.abort()
    return sessionJson({ sessionToken: 'session', status: 'pending_payment' })
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
    pollUntilPaid(client, 'session', controller.signal, value => sessions.push(value)),
  ).rejects.toThrow()
  // Aborted before the next poll: exactly one GET, and the session is not cleared.
  expect(getCount).toBe(1)
  expect(sessions).toEqual([])
})

test('terminal API errors observed while polling clear retained checkout state', async () => {
  process.env.AIMLAPI_APP_URL = 'https://app.example.test'
  process.env.AIMLAPI_INFERENCE_URL = 'https://api.example.test/v1'
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v3/partner-checkout/sessions')) {
      return sessionJson({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { id: 'sess_test', partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ', partnerName: null, userId: null, amountUsdMinor: null, issuedKeyId: null, returnUrl: null, sessionToken: 'session', status: 'pending_payment' },
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
      onSession: session => {
      sessions.push(session)
    },
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
    return sessionJson({ sessionToken: 'session', status: 'paid' })
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
    return sessionJson({ sessionToken: 'session', status: 'paid' })
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
      return sessionJson({ sessionToken: 'session', status: 'pending_auth' })
    }
    if (url.endsWith('/v2/billing/topup')) {
      return Response.json({
        checkout: { providerSessionId: 'provider', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: { id: 'sess_test', partnerId: 'part_62yQoGYDq4Yqnrj2R1iGrDNJ', partnerName: null, userId: null, amountUsdMinor: null, issuedKeyId: null, returnUrl: null, sessionToken: 'session', status: 'pending_payment' },
      })
    }
    return sessionJson({ sessionToken: 'session', status: 'paid' })
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

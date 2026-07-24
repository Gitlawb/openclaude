import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import {
  claimAimlapiTopupState,
  loadAimlapiTopupState,
  saveAimlapiTopupState,
  type AimlapiTopupIntent,
} from './topupState.js'

const directories: string[] = []

afterEach(() => {
  setClaudeConfigHomeDirForTesting(undefined)
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function useTemporaryConfig(): string {
  const directory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-topup-flow-'))
  directories.push(directory)
  setClaudeConfigHomeDirForTesting(directory)
  return directory
}

/** The intent `provisionAimlapiKey` derives from the options used below. */
const intent: AimlapiTopupIntent = {
  email: 'user@example.com',
  amountUsdMinor: 2500,
  autoTopUp: false,
  partnerId: 'part_test',
  partnerName: 'OpenClaude',
  appBaseUrl: 'https://app.aimlapi.com',
  inferenceBaseUrl: 'https://api.aimlapi.com/v1',
}

const provisionOptions = {
  email: intent.email,
  password: 'secret',
  amountUsd: '25',
  partnerId: intent.partnerId,
  partnerName: intent.partnerName,
  model: 'gpt-4o',
  noOpen: true,
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sess_1',
    sessionToken: 'session-token',
    partnerId: intent.partnerId,
    partnerName: intent.partnerName,
    userId: 1,
    amountUsdMinor: intent.amountUsdMinor,
    status: 'paid',
    issuedKeyId: null,
    returnUrl: null,
    ...overrides,
  }
}

type Calls = { createSession: number; getSession: number; pay: number; exchange: number }

/**
 * Load `topup.ts` against a stubbed client. The stub records how often a fresh
 * checkout was opened, which is what the resume behaviour is judged on.
 */
async function importTopupWithClient(stub: {
  getSession?: (token: string) => Promise<unknown>
  createSession?: () => Promise<unknown>
}): Promise<{
  provisionAimlapiKey: (options: unknown) => Promise<{ apiKey: string; apiKeyId: string; model: string }>
  calls: Calls
}> {
  const calls: Calls = { createSession: 0, getSession: 0, pay: 0, exchange: 0 }
  let overrideUsed = false
  const actual = await import('./client.js')

  class StubClient {
    async signup(): Promise<{ token: string; exp: number }> {
      return { token: 'bearer', exp: 1 }
    }
    async createSession(): Promise<unknown> {
      calls.createSession += 1
      return stub.createSession ? await stub.createSession() : session()
    }
    async getSession(token: string): Promise<unknown> {
      calls.getSession += 1
      // The seeded status answers the resume check only. Polling afterwards uses
      // the same method, so keep it paid or the flow would never settle.
      if (stub.getSession && !overrideUsed) {
        overrideUsed = true
        return await stub.getSession(token)
      }
      return session({ sessionToken: token, status: 'paid' })
    }
    async pay(): Promise<unknown> {
      calls.pay += 1
      return {
        checkout: { providerSessionId: 'p', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: session(),
      }
    }
    async exchange(): Promise<{ apiKey: string; apiKeyId: string }> {
      calls.exchange += 1
      return { apiKey: 'k_issued', apiKeyId: 'id_issued' }
    }
  }

  mock.module('./client.js', () => ({ ...actual, AimlapiClient: StubClient }))
  const nonce = `${Date.now()}-${Math.random()}`
  const topup = (await import(`./topup.js?ts=${nonce}`)) as {
    provisionAimlapiKey: (options: unknown) => Promise<{
      apiKey: string
      apiKeyId: string
      model: string
    }>
  }
  return { provisionAimlapiKey: topup.provisionAimlapiKey, calls }
}

test('an interrupted checkout resumes its recorded session instead of charging again', async () => {
  useTemporaryConfig()

  // A previous run got as far as opening the payment page and recorded it.
  const claimed = claimAimlapiTopupState(intent)
  expect(
    saveAimlapiTopupState({
      ...intent,
      paymentSessionId: claimed.paymentSessionId,
      resumeSessionToken: 'recorded-session',
    }),
  ).toBe(true)

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    // The recorded session is still payable.
    getSession: async token => session({ sessionToken: token, status: 'pending_payment' }),
  })
  const provisioned = await provisionAimlapiKey(provisionOptions)

  // The recorded session was reused; no second checkout was opened.
  expect(calls.createSession).toBe(0)
  expect(provisioned.apiKey).toBe('k_issued')
  // The record now carries the settled receipt, held for the caller to persist.
  expect(loadAimlapiTopupState(intent)).toMatchObject({
    apiKey: 'k_issued',
    settled: true,
  })
})

test('a dead recorded session is replaced rather than resumed', async () => {
  useTemporaryConfig()

  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'expired-session',
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    getSession: async token => session({ sessionToken: token, status: 'expired' }),
  })
  await provisionAimlapiKey(provisionOptions)

  // The expired session was inspected, then a fresh checkout was opened.
  expect(calls.createSession).toBe(1)
  expect(loadAimlapiTopupState(intent)).toMatchObject({ settled: true })
})

test('a settled receipt returns the issued key without paying again', async () => {
  useTemporaryConfig()

  // A previous run paid and exchanged, but was interrupted before the caller
  // could persist the credential.
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'spent-session',
    apiKey: 'k_stranded',
    apiKeyId: 'id_stranded',
    model: 'gpt-4o',
    settled: true,
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({})
  const provisioned = await provisionAimlapiKey(provisionOptions)

  // The stranded key came back with no checkout at all.
  expect(provisioned).toMatchObject({ apiKey: 'k_stranded', apiKeyId: 'id_stranded' })
  expect(calls.createSession).toBe(0)
  expect(calls.pay).toBe(0)
  expect(calls.exchange).toBe(0)
  // The receipt is one-shot: it is consumed so a later top-up really charges.
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('a fresh run records its checkout and leaves a settled receipt for the caller', async () => {
  useTemporaryConfig()

  const { provisionAimlapiKey, calls } = await importTopupWithClient({})
  const provisioned = await provisionAimlapiKey(provisionOptions)

  expect(calls.createSession).toBe(1)
  expect(calls.exchange).toBe(1)
  expect(provisioned.apiKey).toBe('k_issued')
  // The key is only returned in memory, so the receipt must survive until the
  // caller has persisted it; otherwise an interruption loses a paid-for key.
  expect(loadAimlapiTopupState(intent)).toMatchObject({
    apiKey: 'k_issued',
    apiKeyId: 'id_issued',
    settled: true,
  })
})

test('a transient getSession failure preserves the recorded checkout', async () => {
  useTemporaryConfig()

  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'recorded-session',
  })

  const { AimlapiApiError } = await import('./client.js')
  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    // A 5xx says nothing about the session's fate.
    getSession: async () => {
      throw new AimlapiApiError('upstream boom', 503, '')
    },
  })

  await expect(provisionAimlapiKey(provisionOptions)).rejects.toThrow('upstream boom')
  // No second checkout was opened, and the record survived for a later re-run.
  expect(calls.createSession).toBe(0)
  expect(loadAimlapiTopupState(intent)).toMatchObject({
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'recorded-session',
  })
})

test('a resumed session that is already paid is not re-bound', async () => {
  useTemporaryConfig()

  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'paid-session',
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    getSession: async token => session({ sessionToken: token, status: 'paid' }),
  })
  const provisioned = await provisionAimlapiKey(provisionOptions)

  // Straight to the exchange: no createSession, and no pay() on a settled
  // checkout.
  expect(calls.createSession).toBe(0)
  expect(calls.pay).toBe(0)
  expect(calls.exchange).toBe(1)
  expect(provisioned.apiKey).toBe('k_issued')
})

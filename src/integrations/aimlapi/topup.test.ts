import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import { AimlapiApiError, type AimlapiClient } from './client.js'
import {
  claimAimlapiTopupState,
  clearAimlapiTopupState,
  loadAimlapiTopupState,
  recordAimlapiCheckoutSession,
  saveAimlapiTopupState,
  type AimlapiTopupIntent,
} from './topupState.js'

// The top-up flow now acquires the checkout-state lock through the async,
// yielding path, so these tests hand control back to the event loop at each
// await. Run alongside the CPU-heavy multi-process lock tests in the same suite,
// a contended runner can push a fast (<10ms of real work) provisioning past the
// 5s default. Give the whole file generous headroom so load — not correctness —
// never trips it.
setDefaultTimeout(30_000)

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
 * Drive `topup.ts` against a stubbed transport by injecting test doubles (no
 * process-global module mock, so nothing bleeds into other suites). The stub
 * records how often a fresh checkout was opened, which is what the resume
 * behaviour is judged on.
 */
async function importTopupWithClient(stub: {
  getSession?: (token: string) => Promise<unknown>
  createSession?: () => Promise<unknown>
  onExchange?: () => void
}): Promise<{
  provisionAimlapiKey: typeof import('./topup.js').provisionAimlapiKey
  runAimlapiTopup: typeof import('./topup.js').runAimlapiTopup
  calls: Calls
  payBodies: Array<Record<string, unknown>>
  savedProfiles: Array<Record<string, unknown>>
}> {
  const calls: Calls = { createSession: 0, getSession: 0, pay: 0, exchange: 0 }
  const payBodies: Array<Record<string, unknown>> = []
  const savedProfiles: Array<Record<string, unknown>> = []
  let overrideUsed = false

  class StubClient {
    async signup(): Promise<{ token: string; exp: number }> {
      return { token: 'bearer', exp: 1 }
    }
    async createSession(): Promise<unknown> {
      calls.createSession += 1
      // A freshly opened checkout is not paid yet; polling flips it to paid.
      return stub.createSession
        ? await stub.createSession()
        : session({ status: 'pending_payment' })
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
    async pay(
      _bearer: string,
      _token: string,
      body: Record<string, unknown>,
    ): Promise<unknown> {
      calls.pay += 1
      payBodies.push(body)
      return {
        checkout: { providerSessionId: 'p', payUrl: 'https://checkout.test/pay' },
        partnerCheckout: session(),
      }
    }
    async exchange(): Promise<{ apiKey: string; apiKeyId: string }> {
      calls.exchange += 1
      // Lets a test steal the state slot at exactly the point where the settled
      // receipt is about to be written.
      stub.onExchange?.()
      return { apiKey: 'k_issued', apiKeyId: 'id_issued' }
    }
  }

  // Load a FRESH topup.js instance via a cache-busting query so it is immune to
  // any `mock.module('../integrations/aimlapi/index.js')` another suite registers
  // (ProviderManager.test.tsx does) — mocking the barrel replaces the shared
  // provisionAimlapiKey binding, which would otherwise reach this file too.
  // Inject the transport through the module's own seam, so there is still no
  // process-global module mock leaking OUT to client.test.ts.
  const nonce = `${Date.now()}-${Math.random()}`
  const topup = (await import(`./topup.js?ts=${nonce}`)) as typeof import('./topup.js')
  topup.setAimlapiTopupTestDoubles({
    createClient: () => new StubClient() as unknown as AimlapiClient,
    // Record the profile write instead of touching disk; the CLI flow only needs
    // the returned path.
    writeProfile: profile => {
      savedProfiles.push(profile as unknown as Record<string, unknown>)
      return '/tmp/openclaude-profile.json'
    },
  })
  return {
    provisionAimlapiKey: topup.provisionAimlapiKey,
    runAimlapiTopup: topup.runAimlapiTopup,
    calls,
    payBodies,
    savedProfiles,
  }
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

test('an already-exchanged session with no local receipt fails closed', async () => {
  useTemporaryConfig()

  // The exchange completed on a prior run but the settled receipt never landed
  // locally (write failed or the process died), leaving only the resume token.
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'spent-session',
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    getSession: async token => session({ sessionToken: token, status: 'exchanged' }),
  })

  // The one-shot key is already gone, so resuming must not open — and charge —
  // a second checkout; it fails closed exactly like pollUntilPaid.
  await expect(provisionAimlapiKey(provisionOptions)).rejects.toThrow(/already exchanged/i)
  expect(calls.createSession).toBe(0)
  expect(calls.pay).toBe(0)
  // The record survives, so every re-run keeps failing closed rather than
  // silently minting a fresh checkout later.
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('spent-session')
})

test('a session recorded by a peer between claim and createSession is adopted', async () => {
  useTemporaryConfig()

  // We claim first, so our in-memory state still carries an empty resume token.
  const claimed = claimAimlapiTopupState(intent)

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    createSession: async () => {
      // A peer racing the same intent records ITS session for the shared payment
      // id in the window after our claim and before we record ours.
      recordAimlapiCheckoutSession({
        ...intent,
        paymentSessionId: claimed.paymentSessionId,
        resumeSessionToken: 'peer-session',
      })
      return session({ sessionToken: 'our-session', status: 'pending_payment' })
    },
    // Answers the adopt-resume read, then the later poll settles it.
    getSession: async token => session({ sessionToken: token, status: 'pending_payment' }),
  })
  const provisioned = await provisionAimlapiKey(provisionOptions)

  // We opened a session but adopted the peer's instead of overwriting the slot,
  // so both runs converge on one payable checkout rather than charging twice.
  expect(calls.createSession).toBe(1)
  expect(calls.pay).toBe(1)
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('peer-session')
  expect(provisioned.apiKey).toBe('k_issued')
})

test('an adopted peer session that is already exchanged fails closed', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    createSession: async () => {
      recordAimlapiCheckoutSession({
        ...intent,
        paymentSessionId: claimed.paymentSessionId,
        resumeSessionToken: 'peer-session',
      })
      return session({ sessionToken: 'our-session', status: 'pending_payment' })
    },
    // The peer's session was exchanged in the race window; pay() must not run.
    getSession: async token => session({ sessionToken: token, status: 'exchanged' }),
  })

  await expect(provisionAimlapiKey(provisionOptions)).rejects.toThrow(/already exchanged/i)
  expect(calls.createSession).toBe(1)
  expect(calls.pay).toBe(0)
})

test('an adopted peer session that is dead fails cleanly instead of paying', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    createSession: async () => {
      recordAimlapiCheckoutSession({
        ...intent,
        paymentSessionId: claimed.paymentSessionId,
        resumeSessionToken: 'peer-session',
      })
      return session({ sessionToken: 'our-session', status: 'pending_payment' })
    },
    // The peer's session was cancelled in the race window.
    getSession: async token => session({ sessionToken: token, status: 'cancelled' }),
  })

  await expect(provisionAimlapiKey(provisionOptions)).rejects.toThrow(/no longer payable/i)
  expect(calls.createSession).toBe(1)
  expect(calls.pay).toBe(0)
})

test('an ambiguous status error preserves the recorded checkout', async () => {
  useTemporaryConfig()

  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'recorded-session',
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    // A 403 says nothing about whether the session is still payable, so it must
    // not retire the record and open a second, separately chargeable checkout.
    getSession: async () => {
      throw new AimlapiApiError('forbidden', 403, '')
    },
  })

  await expect(provisionAimlapiKey(provisionOptions)).rejects.toThrow('forbidden')
  expect(calls.createSession).toBe(0)
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('recorded-session')
})

test('a gone recorded session (404) is replaced with a fresh checkout', async () => {
  useTemporaryConfig()

  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'gone-session',
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    // 404 is a definitive "the session no longer exists", so open a fresh one.
    getSession: async () => {
      throw new AimlapiApiError('gone', 404, '')
    },
  })
  await provisionAimlapiKey(provisionOptions)

  expect(calls.createSession).toBe(1)
})

test('payment polling retries a malformed status body instead of aborting', async () => {
  useTemporaryConfig()
  claimAimlapiTopupState(intent)

  const { provisionAimlapiKey } = await importTopupWithClient({
    // The first poll read is a malformed-but-successful body (status 200); the
    // wait must keep polling rather than abort, matching the resume path.
    getSession: async () => {
      throw new AimlapiApiError('malformed', 200, '')
    },
  })
  const provisioned = await provisionAimlapiKey(provisionOptions)

  expect(provisioned.apiKey).toBe('k_issued')
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
  // The receipt is NOT consumed here: the key is only returned in memory, so it
  // must survive until the caller has durably persisted it (caller-clear
  // contract). Clearing now would drop the sole recoverable copy on a failed
  // persist.
  expect(loadAimlapiTopupState(intent)).toMatchObject({
    apiKey: 'k_stranded',
    settled: true,
  })
})

test('a second top-up only charges again once the caller has cleared the receipt', async () => {
  useTemporaryConfig()

  // First provision leaves a settled receipt behind.
  const first = await importTopupWithClient({})
  await first.provisionAimlapiKey(provisionOptions)
  expect(first.calls.exchange).toBe(1)

  // Without a caller-clear, a second top-up short-circuits on the receipt and
  // returns the same key without opening a checkout - the documented contract.
  const second = await importTopupWithClient({})
  const reused = await second.provisionAimlapiKey(provisionOptions)
  expect(reused.apiKey).toBe('k_issued')
  expect(second.calls.createSession).toBe(0)
  expect(second.calls.exchange).toBe(0)

  // The caller acknowledges its persist by clearing the receipt...
  const stored = loadAimlapiTopupState(intent)!
  clearAimlapiTopupState({ ...intent, paymentSessionId: stored.paymentSessionId })

  // ...after which a genuine second top-up opens and pays for a fresh checkout.
  const third = await importTopupWithClient({})
  await third.provisionAimlapiKey(provisionOptions)
  expect(third.calls.createSession).toBe(1)
  expect(third.calls.pay).toBe(1)
  expect(third.calls.exchange).toBe(1)
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

test('a lost receipt write is surfaced instead of returning as if recoverable', async () => {
  useTemporaryConfig()

  const statuses: Array<[string, string | undefined]> = []
  const { provisionAimlapiKey } = await importTopupWithClient({
    // Another run claims the slot while the key is being exchanged, so the
    // settled receipt can no longer be written for this attempt.
    onExchange: () => {
      clearAimlapiTopupState({
        ...intent,
        paymentSessionId: loadAimlapiTopupState(intent)!.paymentSessionId,
      })
      claimAimlapiTopupState(intent)
    },
  })

  const provisioned = await provisionAimlapiKey({
    ...provisionOptions,
    onStatus: (status: string, detail?: string) => statuses.push([status, detail]),
  })

  // The key still comes back - throwing here would strand it - but the failure
  // to record recovery is reported rather than swallowed.
  expect(provisioned.apiKey).toBe('k_issued')
  expect(
    statuses.some(([, detail]) => detail?.includes('Could not record the recovery receipt')),
  ).toBe(true)
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

test('a session interrupted at exchanging is resumed, not re-charged', async () => {
  useTemporaryConfig()

  // Payment settled and the exchange had begun, but the run was interrupted
  // before the settled receipt was written — the provider reports `exchanging`.
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'exchanging-session',
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    getSession: async token => session({ sessionToken: token, status: 'exchanging' }),
  })
  const provisioned = await provisionAimlapiKey(provisionOptions)

  // Resumed straight to the exchange: no new checkout and no second charge,
  // matching how pollUntilPaid treats an `exchanging` session.
  expect(calls.createSession).toBe(0)
  expect(calls.pay).toBe(0)
  expect(calls.exchange).toBe(1)
  expect(provisioned.apiKey).toBe('k_issued')
})

test('a malformed status response preserves the recorded checkout', async () => {
  useTemporaryConfig()

  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'recorded-session',
  })

  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    // client.getSession throws status 200 for a malformed/empty success body,
    // explicitly as a non-terminal signal.
    getSession: async () => {
      throw new AimlapiApiError('malformed session', 200, '')
    },
  })

  await expect(provisionAimlapiKey(provisionOptions)).rejects.toThrow('malformed session')
  // The record survived rather than being retired into a second checkout.
  expect(calls.createSession).toBe(0)
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('recorded-session')
})

test('a rate-limited status check preserves the recorded checkout', async () => {
  useTemporaryConfig()

  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'recorded-session',
  })

  const { AimlapiApiError } = await import('./client.js')
  const { provisionAimlapiKey, calls } = await importTopupWithClient({
    // 429/408 are transient and say nothing about the session's fate.
    getSession: async () => {
      throw new AimlapiApiError('slow down', 429, '')
    },
  })

  await expect(provisionAimlapiKey(provisionOptions)).rejects.toThrow('slow down')
  expect(calls.createSession).toBe(0)
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('recorded-session')
})

test('checkout binding sends the persisted payment id as the idempotency key', async () => {
  useTemporaryConfig()

  const { provisionAimlapiKey, payBodies } = await importTopupWithClient({})
  await provisionAimlapiKey(provisionOptions)

  // The recorded paymentSessionId must ride along on /pay so a retry references
  // the same charge identity instead of opening a second one.
  const recorded = loadAimlapiTopupState(intent)
  expect(payBodies).toHaveLength(1)
  expect(payBodies[0]?.paymentSessionId).toBeTruthy()
  // It matches the id that was claimed and persisted for this checkout.
  expect(payBodies[0]?.paymentSessionId).toBe(recorded?.paymentSessionId)
})

test('the CLI flow resumes a settled receipt instead of opening a new checkout', async () => {
  useTemporaryConfig()

  // A previous CLI run exchanged the key but was interrupted before (or during)
  // the profile write.
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'exchanged-session',
    apiKey: 'k_paid',
    apiKeyId: 'id_paid',
    model: 'gpt-4o',
    settled: true,
  })

  const { runAimlapiTopup, calls, savedProfiles } = await importTopupWithClient({})
  await runAimlapiTopup({
    email: intent.email,
    password: 'secret',
    amountUsd: '25',
    partnerId: intent.partnerId,
    partnerName: intent.partnerName,
    model: 'gpt-4o',
    noOpen: true,
  })

  // The paid-for key was written to the profile with no new checkout or charge.
  expect(calls.createSession).toBe(0)
  expect(calls.pay).toBe(0)
  expect(calls.exchange).toBe(0)
  expect(savedProfiles).toHaveLength(1)
  expect(savedProfiles[0]?.env).toMatchObject({ OPENAI_API_KEY: 'k_paid' })
  // The record is spent once the profile write (owned by this flow) succeeds.
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('a receipt-write failure after exchange still returns the issued key', async () => {
  const directory = useTemporaryConfig()
  claimAimlapiTopupState(intent)

  const { provisionAimlapiKey } = await importTopupWithClient({
    // Simulate a lock/fs failure at the settled-receipt write by corrupting the
    // state file as the key is exchanged; the read-time guard then throws.
    onExchange: () => {
      writeFileSync(join(directory, 'aimlapi-topup.json'), '{ corrupt', 'utf8')
    },
  })

  // The one-shot key must be delivered despite the failed recovery-receipt write
  // — aborting here would strand a paid-for credential in an exchanged session.
  const provisioned = await provisionAimlapiKey(provisionOptions)
  expect(provisioned.apiKey).toBe('k_issued')
})

test('a receipt-write failure after exchange still writes the CLI profile', async () => {
  const directory = useTemporaryConfig()
  claimAimlapiTopupState(intent)

  const { runAimlapiTopup, savedProfiles } = await importTopupWithClient({
    onExchange: () => {
      writeFileSync(join(directory, 'aimlapi-topup.json'), '{ corrupt', 'utf8')
    },
  })
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  try {
    await runAimlapiTopup({
      email: intent.email,
      password: 'secret',
      amountUsd: '25',
      partnerId: intent.partnerId,
      partnerName: intent.partnerName,
      model: 'gpt-4o',
      noOpen: true,
    })
  } finally {
    console.log = originalLog
  }

  // The profile (with the key) was written despite the failed receipt write and
  // the failed post-delivery cleanup clear.
  expect(savedProfiles).toHaveLength(1)
  expect(savedProfiles[0]?.env).toMatchObject({ OPENAI_API_KEY: 'k_issued' })
  // The failed cleanup is surfaced to the user (not just --debug), pointing at
  // the reset escape hatch.
  expect(logs.join('\n')).toContain('Could not clear the aimlapi.com recovery receipt')
})

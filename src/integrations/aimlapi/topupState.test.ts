import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import {
  acquireAimlapiExchangeLeaseAsync,
  releaseAimlapiExchangeLeaseAsync,
  claimAimlapiTopupState,
  clearAimlapiTopupState,
  clearAimlapiTopupStateAsync,
  clearAimlapiSignInKey,
  loadAimlapiSignInKey,
  loadAimlapiTopupState,
  recordAimlapiCheckoutSession,
  recordAimlapiSettledKeyAsync,
  saveAimlapiSignInKey,
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
  const directory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-topup-'))
  directories.push(directory)
  setClaudeConfigHomeDirForTesting(directory)
  return directory
}

const intent: AimlapiTopupIntent = {
  email: 'user@example.com',
  amountUsdMinor: 2500,
  autoTopUp: false,
  partnerId: 'part_test',
  partnerName: 'OpenClaude',
  appBaseUrl: 'https://app.example.test',
  inferenceBaseUrl: 'https://api.example.test/v1',
  payBaseUrl: 'https://pay.example.test',
  verificationBaseUrl: 'https://front.example.test',
}

test('top-up state round-trips only for the same checkout intent', () => {
  const directory = useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'session-token',
  })

  expect(loadAimlapiTopupState(intent)).toEqual({
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'session-token',
  })
  expect(loadAimlapiTopupState({ ...intent, amountUsdMinor: 3000 })).toBeNull()
  expect(readFileSync(join(directory, 'aimlapi-topup.json'), 'utf8')).toContain(
    'session-token',
  )
  if (process.platform !== 'win32') {
    expect(statSync(join(directory, 'aimlapi-topup.json')).mode & 0o777).toBe(0o600)
  }
})

test('the exchange lease elects one exchanger and lets peers resume the settled key', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  // The first process holds the lease and is the sole cleared exchanger.
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')).status).toBe('acquired')
  // A concurrent peer finds a fresh foreign lease and must back off (not exchange).
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('held')

  // Once the holder records the settled key, a peer resumes from it.
  saveAimlapiTopupState({
    ...expected,
    resumeSessionToken: '',
    apiKey: 'exchanged-key',
    apiKeyId: 'exchanged-id',
    settled: true,
  })
  const resumed = await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')
  expect(resumed.status).toBe('settled')
  expect(resumed.status === 'settled' && resumed.state.apiKey).toBe('exchanged-key')

  // A cleared/reset slot reports 'gone' so a stray process never exchanges it.
  clearAimlapiTopupState(expected)
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')).status).toBe('gone')
})

test('a failed exchange releases the lease so a retry can proceed', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')).status).toBe('acquired')
  // A peer is blocked while the lease is held.
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('held')
  // The holder's exchange failed, so it releases the lease...
  await releaseAimlapiExchangeLeaseAsync(expected, 'owner-a')
  // ...and the next acquirer may proceed instead of waiting out the stale window.
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('acquired')
})

test('releasing the exchange lease is scoped to the owner and never drops a settled receipt', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')).status).toBe('acquired')
  // A peer must not be able to release a lease it does not own — otherwise it
  // could free a live holder's lease and start a parallel one-shot exchange.
  await releaseAimlapiExchangeLeaseAsync(expected, 'owner-b')
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('held')

  // A settled receipt supersedes the lease: releasing must leave it intact so a
  // peer still resumes from the recorded key rather than re-exchanging.
  saveAimlapiTopupState({
    ...expected,
    resumeSessionToken: '',
    apiKey: 'exchanged-key',
    apiKeyId: 'exchanged-id',
    settled: true,
  })
  await releaseAimlapiExchangeLeaseAsync(expected, 'owner-a')
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('settled')
})

test('a future-dated exchange lease is reclaimed instead of pinning the slot forever', async () => {
  const directory = useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  // A foreign lease timestamped in the future (backwards clock jump or an edited
  // state file). A negative age would read as perpetually fresh — and clamping it
  // to 0 would still keep it held — so every peer would deadlock. It must be
  // treated as stale and reclaimed.
  const futureLeaseAt = Date.now() + 60 * 60 * 1000
  saveAimlapiTopupState({
    ...expected,
    resumeSessionToken: '',
    exchangeLeaseOwner: 'ghost-owner',
    exchangeLeaseAt: futureLeaseAt,
  })
  // Guard against a vacuous pass: if the seeding compare-and-swap were rejected,
  // no lease would exist and acquire would report 'acquired' without ever
  // exercising the future-dated reclaim path. Confirm the lease actually landed.
  const seeded = JSON.parse(readFileSync(join(directory, 'aimlapi-topup.json'), 'utf8'))
  expect(seeded.exchangeLeaseOwner).toBe('ghost-owner')
  expect(seeded.exchangeLeaseAt).toBe(futureLeaseAt)

  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('acquired')
})

test('claiming a different intent refuses to clobber an opened (possibly paid) checkout', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  // The checkout was opened: a resume token is recorded and the session may
  // already be paid but not yet exchanged.
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'paid-session',
  })

  // A rerun with a different amount must not drop that record (which would strand
  // the paid session); it refuses so the caller resumes or cancels it first.
  expect(() => claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })).toThrow(
    /hasn't finished and may already be paid/i,
  )
  // The in-flight record survives intact for the original intent.
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('paid-session')
})

test('claiming a different intent refuses to clobber a settled-but-unpersisted key', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: '',
    apiKey: 'exchanged-key',
    apiKeyId: 'exchanged-id',
    settled: true,
  })

  // A settled key not yet written to a profile is still recoverable only via this
  // record; a changed intent must not silently discard it.
  expect(() => claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })).toThrow(
    /hasn't finished/i,
  )
})

test('claiming a different intent replaces a never-advanced claim', () => {
  useTemporaryConfig()
  // A fresh claim that never opened a checkout (empty resume token, unsettled, no
  // key) holds nothing chargeable, so a changed amount safely replaces it.
  claimAimlapiTopupState(intent)
  const next = claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })
  expect(next.paymentSessionId).toBeTruthy()
  expect(loadAimlapiTopupState(intent)).toBeNull()
  expect(loadAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })).not.toBeNull()
})

test('an empty key id is stored as absent so the settled receipt stays readable', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  // The existing-key top-up path reports apiKeyId: '' (there is no retrievable
  // id). A serialized "" fails read validation and would make the whole receipt —
  // and the paid key it records — unrecoverable. It must round-trip as absent.
  saveAimlapiTopupState({
    ...expected,
    resumeSessionToken: 'paid-session',
    apiKey: 'existing-key',
    apiKeyId: '',
    settled: true,
  })

  const loaded = loadAimlapiTopupState(intent)
  expect(loaded?.settled).toBe(true)
  expect(loaded?.apiKey).toBe('existing-key')
  expect(loaded?.apiKeyId).toBeUndefined()
})

test('recordAimlapiSettledKeyAsync persists the key and clears the lease under the CAS', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }
  // The winner holds the lease while it runs the one-shot exchange.
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')).status).toBe('acquired')

  await recordAimlapiSettledKeyAsync(expected, {
    apiKey: 'exchanged-key',
    apiKeyId: 'exchanged-id',
    model: 'gpt-4o',
  })

  // The receipt is readable (settled + key) and supersedes the lease, so a peer
  // resumes from it rather than finding a lingering lease.
  const loaded = loadAimlapiTopupState(intent)
  expect(loaded?.settled).toBe(true)
  expect(loaded?.apiKey).toBe('exchanged-key')
  expect(loaded?.apiKeyId).toBe('exchanged-id')
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('settled')

  // CAS: it is a no-op once the slot no longer belongs to this intent + payment id.
  clearAimlapiTopupState(expected)
  await recordAimlapiSettledKeyAsync(expected, { apiKey: 'late-key' })
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('clearAimlapiTopupStateAsync clears only its matching intent', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'session-token',
  })

  // The async clear (used by the Ink flow so a contended lock never blocks the
  // UI) is ownership-aware like the sync one: a foreign intent removes nothing.
  await clearAimlapiTopupStateAsync({
    ...intent,
    email: 'other@example.com',
    paymentSessionId: claimed.paymentSessionId,
  })
  expect(loadAimlapiTopupState(intent)).not.toBeNull()

  await clearAimlapiTopupStateAsync({ ...intent, paymentSessionId: claimed.paymentSessionId })
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('recordAimlapiCheckoutSession elects the first session token and a loser adopts it', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const base = { ...intent, paymentSessionId: claimed.paymentSessionId }

  // First writer wins: its token is stored.
  const winner = recordAimlapiCheckoutSession({ ...base, resumeSessionToken: 'session-A' })
  expect(winner?.resumeSessionToken).toBe('session-A')

  // A concurrent peer recording a different session does NOT overwrite the
  // winner — it gets the winning token back and adopts it, so only one checkout
  // is ever payable.
  const loser = recordAimlapiCheckoutSession({ ...base, resumeSessionToken: 'session-B' })
  expect(loser?.resumeSessionToken).toBe('session-A')
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('session-A')

  // A slot that no longer belongs to this payment id records nothing.
  expect(
    recordAimlapiCheckoutSession({
      ...intent,
      paymentSessionId: 'other-payment-id',
      resumeSessionToken: 'session-C',
    }),
  ).toBeNull()
})

test('top-up state is cleared only by its matching intent', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'session-token',
  })

  clearAimlapiTopupState({
    ...intent,
    email: 'other@example.com',
    paymentSessionId: claimed.paymentSessionId,
  })
  expect(loadAimlapiTopupState(intent)).not.toBeNull()
  clearAimlapiTopupState({ ...intent, paymentSessionId: claimed.paymentSessionId })
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('claiming the same checkout intent reuses one payment id', () => {
  useTemporaryConfig()
  const first = claimAimlapiTopupState(intent)
  const second = claimAimlapiTopupState(intent)

  expect(first.paymentSessionId).toBeTruthy()
  expect(second).toEqual(first)
})

test('stale writers cannot overwrite a newly claimed checkout', () => {
  useTemporaryConfig()
  const stale = claimAimlapiTopupState(intent)
  clearAimlapiTopupState({ ...intent, paymentSessionId: stale.paymentSessionId })

  const currentIntent = { ...intent, email: 'new@example.com' }
  const current = claimAimlapiTopupState(currentIntent)
  saveAimlapiTopupState({
    ...intent,
    ...stale,
    resumeSessionToken: 'stale-session',
  })

  expect(loadAimlapiTopupState(currentIntent)).toEqual(current)
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('stale clear cannot delete a replacement checkout', () => {
  useTemporaryConfig()
  const stale = claimAimlapiTopupState(intent)
  clearAimlapiTopupState({ ...intent, paymentSessionId: stale.paymentSessionId })

  const current = claimAimlapiTopupState(intent)
  clearAimlapiTopupState({ ...intent, paymentSessionId: stale.paymentSessionId })

  expect(current.paymentSessionId).not.toBe(stale.paymentSessionId)
  expect(loadAimlapiTopupState(intent)).toEqual(current)
})

test('sign-in key cache round-trips by normalized email and clears', () => {
  useTemporaryConfig()

  expect(loadAimlapiSignInKey('User@Example.com')).toBeNull()

  saveAimlapiSignInKey('User@Example.com', 'k_signin', 'id_signin')
  // Lookup is case/whitespace-insensitive on the email.
  expect(loadAimlapiSignInKey('user@example.com')).toEqual({
    apiKey: 'k_signin',
    apiKeyId: 'id_signin',
  })
  // A different email must not read this key.
  expect(loadAimlapiSignInKey('other@example.com')).toBeNull()

  clearAimlapiSignInKey('user@example.com', 'id_signin')
  expect(loadAimlapiSignInKey('user@example.com')).toBeNull()
})

test('sign-in key cache rejects records missing the key identifier', () => {
  const directory = useTemporaryConfig()
  const cachePath = join(directory, 'aimlapi-signin-key.json')

  // A persisted record without a usable apiKeyId cannot bypass createKey.
  writeFileSync(
    cachePath,
    JSON.stringify({ email: 'user@example.com', apiKey: 'k_signin', apiKeyId: '' }),
  )
  expect(loadAimlapiSignInKey('user@example.com')).toBeNull()

  writeFileSync(
    cachePath,
    JSON.stringify({ email: 'user@example.com', apiKey: 'k_signin' }),
  )
  expect(loadAimlapiSignInKey('user@example.com')).toBeNull()

  // The save guard refuses to persist an incomplete receipt in the first place.
  rmSync(cachePath, { force: true })
  saveAimlapiSignInKey('user@example.com', 'k_signin', '  ')
  expect(loadAimlapiSignInKey('user@example.com')).toBeNull()
  expect(existsSync(cachePath)).toBe(false)
})

test('sign-in key cache retains a separate record per email', () => {
  useTemporaryConfig()
  saveAimlapiSignInKey('a@example.com', 'k_a', 'id_a')
  // A concurrent or interrupted sign-in for another account must NOT evict the
  // first account's recovery key (which previously forced a duplicate mint).
  saveAimlapiSignInKey('b@example.com', 'k_b', 'id_b')

  expect(loadAimlapiSignInKey('a@example.com')).toEqual({ apiKey: 'k_a', apiKeyId: 'id_a' })
  expect(loadAimlapiSignInKey('b@example.com')).toEqual({ apiKey: 'k_b', apiKeyId: 'id_b' })
})

test('sign-in key cache migrates a legacy single-record file', () => {
  const directory = useTemporaryConfig()
  const cachePath = join(directory, 'aimlapi-signin-key.json')
  // Pre-collection format: a single { email, apiKey, apiKeyId } record.
  writeFileSync(
    cachePath,
    JSON.stringify({ email: 'User@Example.com', apiKey: 'k_legacy', apiKeyId: 'id_legacy' }),
  )
  // Migrated on read, keyed by the normalized email.
  expect(loadAimlapiSignInKey('user@example.com')).toEqual({
    apiKey: 'k_legacy',
    apiKeyId: 'id_legacy',
  })
  // A subsequent save for a different account keeps the migrated record too.
  saveAimlapiSignInKey('other@example.com', 'k_other', 'id_other')
  expect(loadAimlapiSignInKey('user@example.com')).toEqual({
    apiKey: 'k_legacy',
    apiKeyId: 'id_legacy',
  })
  expect(loadAimlapiSignInKey('other@example.com')).toEqual({
    apiKey: 'k_other',
    apiKeyId: 'id_other',
  })
})

test('sign-in key clear removes only the owning email and keeps the others', () => {
  useTemporaryConfig()
  saveAimlapiSignInKey('user@example.com', 'k_signin', 'id_signin')
  saveAimlapiSignInKey('other@example.com', 'k_other', 'id_other')

  // Clearing one email leaves the other account's record intact...
  clearAimlapiSignInKey('user@example.com', 'id_signin')
  expect(loadAimlapiSignInKey('user@example.com')).toBeNull()
  expect(loadAimlapiSignInKey('other@example.com')).toEqual({
    apiKey: 'k_other',
    apiKeyId: 'id_other',
  })

  // ...and a mismatched id never deletes an entry.
  clearAimlapiSignInKey('other@example.com', 'stale-id')
  expect(loadAimlapiSignInKey('other@example.com')).toEqual({
    apiKey: 'k_other',
    apiKeyId: 'id_other',
  })
  clearAimlapiSignInKey('other@example.com', 'id_other')
  expect(loadAimlapiSignInKey('other@example.com')).toBeNull()
})

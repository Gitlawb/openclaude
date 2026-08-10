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
  refreshAimlapiExchangeLeaseAsync,
  releaseAimlapiExchangeLeaseAsync,
  claimAimlapiTopupState,
  claimAimlapiTopupStateAsync,
  clearAimlapiTopupState,
  clearAimlapiTopupStateAsync,
  clearAimlapiSignInKey,
  loadAimlapiSignInKey,
  loadAimlapiTopupState,
  recordAimlapiCheckoutSession,
  recordAimlapiSettledKeyAsync,
  resetAimlapiCheckoutSession,
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

test('claimAimlapiTopupStateAsync behaves like the sync claim (non-blocking for the interactive flow)', async () => {
  useTemporaryConfig()

  // Fresh claim.
  const claimed = await claimAimlapiTopupStateAsync(intent)
  expect(claimed.paymentSessionId).toBeTruthy()
  expect(claimed.resumeSessionToken).toBe('')

  // Resuming the SAME intent returns the same claim.
  const resumed = await claimAimlapiTopupStateAsync(intent)
  expect(resumed.paymentSessionId).toBe(claimed.paymentSessionId)

  // A differing intent against an opened (chargeable) checkout is refused
  // without abandonExisting, same as the sync claim.
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'live-session',
  })
  await expect(
    claimAimlapiTopupStateAsync({ ...intent, amountUsdMinor: 5000 }),
  ).rejects.toThrow(/hasn't finished and may already be paid/i)

  // abandonExisting overrides the refusal, same as the sync claim.
  const abandoned = await claimAimlapiTopupStateAsync(
    { ...intent, amountUsdMinor: 5000 },
    { abandonExisting: true },
  )
  expect(abandoned.paymentSessionId).not.toBe(claimed.paymentSessionId)
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

test('refreshing the exchange lease keeps a live long wait from going stale', async () => {
  const directory = useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  const acquired = await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')
  expect(acquired.status).toBe('acquired')

  // Simulate owner-a sitting in a long `wait-exchange` poll: the lease's
  // timestamp ages well past what a single POST would ever take, exactly the
  // window a peer would otherwise reclaim it in.
  const staleState = JSON.parse(readFileSync(join(directory, 'aimlapi-topup.json'), 'utf8'))
  staleState.exchangeLeaseAt = Date.now() - 60_000
  writeFileSync(join(directory, 'aimlapi-topup.json'), JSON.stringify(staleState))

  // owner-a refreshes (as pollUntilExchangeSettled now does every iteration)
  // instead of letting the aged timestamp stand.
  expect(await refreshAimlapiExchangeLeaseAsync(expected, 'owner-a')).toBe(true)

  // A peer arriving right after the refresh must back off — the lease is live
  // again, not stale — instead of reclaiming it and racing owner-a to /exchange.
  const peerAttempt = await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')
  expect(peerAttempt.status).toBe('held')
  if (peerAttempt.status === 'held') {
    expect(peerAttempt.owner).toBe('owner-a')
    expect(peerAttempt.ageMs).toBeLessThan(1_000)
  }
})

test('refreshing a lease this process no longer owns reports false and touches nothing', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }

  await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')
  // No owner recorded at all (e.g. the record was reset/cleared meanwhile).
  expect(await refreshAimlapiExchangeLeaseAsync(expected, 'owner-b')).toBe(false)
  // The real owner's lease is untouched by the failed foreign refresh.
  const stillHeld = await acquireAimlapiExchangeLeaseAsync(expected, 'owner-c')
  expect(stillHeld.status).toBe('held')
  if (stillHeld.status === 'held') expect(stillHeld.owner).toBe('owner-a')
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

test('abandonExisting overrides the refusal once the caller has confirmed abandonment', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'paid-session',
  })

  // Same conflict as the refusal test above, but the caller has already gotten
  // an explicit user confirmation to abandon the retained checkout.
  const next = claimAimlapiTopupState(
    { ...intent, amountUsdMinor: 5000 },
    { abandonExisting: true },
  )
  expect(next.paymentSessionId).not.toBe(claimed.paymentSessionId)
  expect(next.resumeSessionToken).toBe('')
  // The old record is fully replaced, not left dangling for a stale peer to read.
  expect(loadAimlapiTopupState(intent)).toBeNull()
  expect(loadAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })).not.toBeNull()
})

test('abandonExisting retains an already-minted (unpaid) key instead of discarding it', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: '',
    apiKey: 'minted-key',
    apiKeyId: 'minted-id',
  })

  // An existing-account key was already minted for this account, but no
  // checkout was opened/paid yet — abandoning the amount must not throw the
  // key away along with the dead payment session.
  const next = claimAimlapiTopupState(
    { ...intent, amountUsdMinor: 5000 },
    { abandonExisting: true },
  )
  expect(next.paymentSessionId).not.toBe(claimed.paymentSessionId)
  expect(next.resumeSessionToken).toBe('')
  expect(next.apiKey).toBe('minted-key')
  expect(next.apiKeyId).toBe('minted-id')
  expect(loadAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })?.apiKey).toBe('minted-key')
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
  // record; a changed intent must not silently discard it — not even with
  // abandonExisting, since that confirms giving up an UNPAID checkout, never
  // an already paid + exchanged credential.
  expect(() => claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })).toThrow(
    /already succeeded/i,
  )
  expect(() =>
    claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 }, { abandonExisting: true }),
  ).toThrow(/already succeeded/i)
  expect(loadAimlapiTopupState(intent)?.apiKey).toBe('exchanged-key')
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

test('resetAimlapiCheckoutSession refreshes the payment session while keeping the minted key', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'dead-session',
    apiKey: 'existing-key',
    apiKeyId: 'existing-id',
  })

  const refreshed = resetAimlapiCheckoutSession({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
  })

  expect(refreshed).not.toBeNull()
  expect(refreshed?.paymentSessionId).not.toBe(claimed.paymentSessionId)
  expect(refreshed?.resumeSessionToken).toBe('')
  expect(refreshed?.apiKey).toBe('existing-key')
  expect(refreshed?.apiKeyId).toBe('existing-id')
  // The refreshed record — not the dead one — is what a subsequent load sees.
  expect(loadAimlapiTopupState(intent)).toEqual({
    paymentSessionId: refreshed!.paymentSessionId,
    resumeSessionToken: '',
    apiKey: 'existing-key',
    apiKeyId: 'existing-id',
  })
})

test('resetAimlapiCheckoutSession is a no-op when there is no minted key to preserve', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  // Never advanced past the initial claim: no key was ever issued.
  const result = resetAimlapiCheckoutSession({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
  })

  expect(result).toBeNull()
  // Nothing was dropped or rewritten.
  expect(loadAimlapiTopupState(intent)).toEqual({
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: '',
  })
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

test('recordAimlapiSettledKeyAsync never settles a receipt without a key', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const expected = { ...intent, paymentSessionId: claimed.paymentSessionId }
  // A holder is mid-exchange (holds the lease) but has no stored key yet.
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-a')).status).toBe('acquired')

  // No key resolved (none passed, none stored): the receipt must NOT be marked
  // settled and the lease must survive, so a retry can still run the exchange
  // rather than resuming from a keyless receipt for a spent one-shot exchange.
  await recordAimlapiSettledKeyAsync(expected, { apiKey: '' })

  expect(loadAimlapiTopupState(intent)?.settled).not.toBe(true)
  // The lease must remain HELD (owner-a's, intact) — not merely "not settled":
  // if the keyless call had wrongly cleared the lease, owner-b would see
  // 'acquired', so assert 'held' to pin that the retry path is preserved.
  expect((await acquireAimlapiExchangeLeaseAsync(expected, 'owner-b')).status).toBe('held')
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

test('saveAimlapiTopupState never wipes a peer-recorded resumeSessionToken', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const base = { ...intent, paymentSessionId: claimed.paymentSessionId }

  // A peer process for the SAME intent (e.g. a second CLI/GUI run) elects and
  // records a real checkout session in the window between this process's
  // claim and its next save.
  const peerRecorded = recordAimlapiCheckoutSession({ ...base, resumeSessionToken: 'peer-session' })
  expect(peerRecorded?.resumeSessionToken).toBe('peer-session')

  // This process's own in-memory checkoutState still has an empty
  // resumeSessionToken (it claimed before the peer raced ahead and created a
  // session) — e.g. the sign-in path saving a freshly minted key.
  saveAimlapiTopupState({
    ...base,
    resumeSessionToken: '',
    apiKey: 'minted-key',
    apiKeyId: 'minted-id',
  })

  // The peer's chargeable checkout must survive: a stale empty token must
  // never overwrite a real one.
  const after = loadAimlapiTopupState(intent)
  expect(after?.resumeSessionToken).toBe('peer-session')
  expect(after?.apiKey).toBe('minted-key')
  expect(after?.apiKeyId).toBe('minted-id')
})

test('saveAimlapiTopupState elects the first-recorded existing-account key over a later mint', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const base = { ...intent, paymentSessionId: claimed.paymentSessionId }

  // Peer A mints and records its key first.
  saveAimlapiTopupState({ ...base, resumeSessionToken: '', apiKey: 'key-a', apiKeyId: 'id-a' })

  // Peer B, racing the same intent, minted its OWN (different) key before
  // seeing peer A's save, and now tries to persist it.
  saveAimlapiTopupState({ ...base, resumeSessionToken: '', apiKey: 'key-b', apiKeyId: 'id-b' })

  // Peer A's key must stay authoritative — peer B's mint is now an orphan
  // that nobody's receipt points to, but it must not silently replace the
  // key everyone else (and the eventual profile write) converges on.
  const after = loadAimlapiTopupState(intent)
  expect(after?.apiKey).toBe('key-a')
  expect(after?.apiKeyId).toBe('id-a')
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

test('sign-in key cache elects the first-recorded key over a later mint', () => {
  useTemporaryConfig()

  // Peer A mints and caches its key for this email first.
  saveAimlapiSignInKey('user@example.com', 'key-a', 'id-a')
  // Peer B, racing the same email, minted its OWN key before seeing peer A's
  // save and now tries to cache it.
  saveAimlapiSignInKey('user@example.com', 'key-b', 'id-b')

  // Peer A's key stays authoritative — every caller converges on it instead
  // of whichever peer happened to save last.
  expect(loadAimlapiSignInKey('user@example.com')).toEqual({
    apiKey: 'key-a',
    apiKeyId: 'id-a',
  })
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

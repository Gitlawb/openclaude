import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import {
  claimAimlapiTopupState,
  claimAimlapiTopupStateAsync,
  clearAimlapiTopupState,
  clearAimlapiTopupStateAsync,
  clearAimlapiSignInKey,
  loadAimlapiSignInKey,
  loadAimlapiTopupState,
  recordAimlapiCheckoutSessionAsync,
  resetAimlapiCheckoutSession,
  saveAimlapiSignInKey,
  saveAimlapiTopupState,
  saveAimlapiTopupStateAsync,
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
}

const LOCK_STALE_MS = 30_000

function lockPathFor(directory: string): string {
  return join(directory, 'aimlapi-topup.json.lock')
}

// proper-lockfile represents a held lock as a directory. Pre-create one and
// optionally back-date its mtime. `stale: true` ages it well past the stale
// window so the next acquirer treats it as abandoned; `ageMs` back-dates by an
// exact amount (e.g. to just inside the window, so it goes stale soon).
function holdLock(
  directory: string,
  options: { stale: boolean; ageMs?: number },
): string {
  const lock = lockPathFor(directory)
  mkdirSync(lock)
  const ageMs = options.ageMs ?? (options.stale ? LOCK_STALE_MS * 2 : 0)
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs)
    utimesSync(lock, past, past)
  }
  return lock
}

test('a stale lock is stolen so the operation still completes', () => {
  const directory = useTemporaryConfig()
  holdLock(directory, { stale: true })

  // The abandoned lock must not wedge the flow: claiming proceeds and the state
  // is written normally.
  const claimed = claimAimlapiTopupState(intent)
  expect(claimed.paymentSessionId).toBeTruthy()
  expect(loadAimlapiTopupState(intent)?.paymentSessionId).toBe(claimed.paymentSessionId)
  // The stolen lock is released, not left behind as a fresh blocker.
  expect(existsSync(lockPathFor(directory))).toBe(false)
})

test('the async path reclaims a lock orphaned by an interrupted holder', async () => {
  const directory = useTemporaryConfig()
  // A lock left by an interrupted holder, back-dated to just inside the stale
  // window (the source stale window is 8s) so it goes stale ~1.5s from now. The
  // async path keeps retrying — yielding between attempts rather than parking
  // the thread — and reclaims it once stale, so a resume after an interruption
  // is not defeated. Its deadline is deliberately longer than the stale window
  // (unlike the shorter sync timeout the test below exercises), so recovery is
  // not cut off while the orphan is still fresh.
  holdLock(directory, { stale: false, ageMs: 6_500 })

  const claimed = await claimAimlapiTopupStateAsync(intent)
  expect(claimed.paymentSessionId).toBeTruthy()
  expect(loadAimlapiTopupState(intent)?.paymentSessionId).toBe(claimed.paymentSessionId)
  expect(existsSync(lockPathFor(directory))).toBe(false)
}, 20_000)

// The async mutators share their inner operations with the sync wrappers, so a
// thin contract check per variant is enough to lock behaviour the CLI/GUI flow
// now depends on (the semantics themselves are covered against the sync path).
test('the async save reports whether the compare-and-swap write landed', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const record = {
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'session-token',
  }
  // Matching intent + payment session lands; a stale payment session is refused.
  expect(await saveAimlapiTopupStateAsync(record)).toBe(true)
  expect(
    await saveAimlapiTopupStateAsync({ ...record, paymentSessionId: 'stale' }),
  ).toBe(false)
})

test('the async record is a compare-and-swap on the empty resume token', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const base = { ...intent, paymentSessionId: claimed.paymentSessionId }

  // The first writer wins the token; a second recorder adopts it rather than
  // overwriting; a stale payment session cannot record at all.
  const first = await recordAimlapiCheckoutSessionAsync({ ...base, resumeSessionToken: 'first' })
  expect(first?.resumeSessionToken).toBe('first')
  const second = await recordAimlapiCheckoutSessionAsync({ ...base, resumeSessionToken: 'second' })
  expect(second?.resumeSessionToken).toBe('first')
  expect(
    await recordAimlapiCheckoutSessionAsync({
      ...intent,
      paymentSessionId: 'stale',
      resumeSessionToken: 'x',
    }),
  ).toBeNull()
})

test('the async clear only retires the matching checkout', async () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)

  // A mismatched payment session must not clear another flow's record.
  await clearAimlapiTopupStateAsync({ ...intent, paymentSessionId: 'other' })
  expect(loadAimlapiTopupState(intent)?.paymentSessionId).toBe(claimed.paymentSessionId)
  // The matching one retires it.
  await clearAimlapiTopupStateAsync({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
  })
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('a fresh lock held by another process times out instead of corrupting state', () => {
  const directory = useTemporaryConfig()
  holdLock(directory, { stale: false })

  // The message names the condition it kept hitting, for diagnosis. The exact
  // code is not pinned: a held lock surfaces as ELOCKED on POSIX but can be
  // EPERM/EEXIST/etc. on Windows (see topupState.ts), and this test is about the
  // timeout-without-writing behaviour, not the platform's lock errno.
  expect(() => claimAimlapiTopupState(intent)).toThrow(
    /Timed out waiting for the AI\/ML API checkout state lock \(last: [A-Z]+, \d+ retries\)/,
  )
  // Nothing was written behind the held lock.
  expect(existsSync(join(directory, 'aimlapi-topup.json'))).toBe(false)
  // The other holder's lock is intact.
  expect(existsSync(lockPathFor(directory))).toBe(true)
}, 20_000)

// Barrier: every worker busy-waits to a shared wall-clock instant before
// claiming. Without it, process-startup jitter staggers the workers so the first
// writes state before the rest read it, and even a no-op lock would "converge" -
// the barrier forces them into the critical section together so a broken lock
// actually diverges.
const WORKER_BARRIER: ReadonlyArray<string> = [
  `const intent = ${JSON.stringify(intent)}`,
  `const startAt = Number(process.env.WORKER_START_AT)`,
  `while (Date.now() < startAt) { /* spin to the barrier */ }`,
]

function defaultClaimWorker(modulePath: string): string[] {
  return [
    `import { claimAimlapiTopupState } from ${JSON.stringify(modulePath)}`,
    ...WORKER_BARRIER,
    `process.stdout.write(claimAimlapiTopupState(intent).paymentSessionId)`,
  ]
}

// Claim, then record a unique resume token. Reports 'won' only for the process
// that actually established the token. Under a stale-lock steal the claims can
// briefly diverge, but the single-slot store keeps one payment id and the record
// step's compare-and-swap lands exactly once, so the caller can assert that
// precisely one checkout is created no matter how the claims raced.
function claimAndRecordWorker(modulePath: string): string[] {
  return [
    `import { claimAimlapiTopupState, recordAimlapiCheckoutSession } from ${JSON.stringify(modulePath)}`,
    ...WORKER_BARRIER,
    `const claimed = claimAimlapiTopupState(intent)`,
    `const token = 'token-' + process.pid`,
    `const recorded = recordAimlapiCheckoutSession({ ...intent, paymentSessionId: claimed.paymentSessionId, resumeSessionToken: token })`,
    `process.stdout.write(recorded && recorded.resumeSessionToken === token ? 'won' : 'lost')`,
  ]
}

/**
 * Run a worker body for the same intent in N separate processes and return each
 * one's stdout. Real processes are the only way to exercise the lock's
 * cross-process ownership: in-process calls never interleave inside the
 * synchronous acquire/release sequence.
 */
async function claimFromProcesses(
  directory: string,
  count: number,
  buildWorker: (modulePath: string) => string[] = defaultClaimWorker,
): Promise<string[]> {
  const script = join(directory, 'claim-worker.ts')
  // A raw absolute path is not a valid ESM specifier (on Windows it is also
  // backslash-separated), so hand the worker a file:// URL instead of relying on
  // the runtime tolerating a bare path.
  const modulePath = pathToFileURL(join(import.meta.dir, 'topupState.ts')).href
  writeFileSync(script, buildWorker(modulePath).join('\n'), 'utf8')

  // Enough lead time for every worker to spawn and reach the spin before it ends.
  const startAt = String(Date.now() + 250 * count + 1000)
  const workers = Array.from({ length: count }, () =>
    // Spawn the same runtime that runs the test, not whatever `bun` resolves to
    // on PATH.
    Bun.spawn([process.execPath, script], {
      env: {
        ...process.env,
        OPENCLAUDE_CONFIG_DIR: directory,
        WORKER_START_AT: startAt,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  )

  try {
    return await Promise.all(
      workers.map(async worker => {
        // Bound the exit first: a hung worker never closes its pipes, so draining
        // stdout/stderr before this would block past the guard. Clear the timer
        // on the happy path so no 30s timer lingers after the test.
        let timer: ReturnType<typeof setTimeout> | undefined
        const code = await Promise.race([
          worker.exited,
          new Promise<number>((_, reject) => {
            timer = setTimeout(() => reject(new Error('worker timed out')), 30_000)
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer)
        })
        // The worker has exited, so its pipes are closed and these resolve.
        const [out, err] = await Promise.all([
          new Response(worker.stdout).text(),
          new Response(worker.stderr).text(),
        ])
        if (code !== 0) throw new Error(`worker failed (${code}): ${err}\n${out}`)
        return out.trim()
      }),
    )
  } finally {
    // Never leave a worker running (kill is a no-op once it has exited).
    for (const worker of workers) worker.kill()
  }
}

test('concurrent processes converge on a single payment session', async () => {
  const directory = useTemporaryConfig()

  const sessions = await claimFromProcesses(directory, 5)

  // Exactly one process may mint a payment session; the rest must adopt it.
  // Divergence here would mean a second checkout - the duplicate charge this
  // module exists to prevent.
  expect(sessions).toHaveLength(5)
  expect(new Set(sessions).size).toBe(1)
  expect(loadAimlapiTopupState(intent)?.paymentSessionId).toBe(sessions[0])
  // Every holder released its own lock.
  expect(existsSync(lockPathFor(directory))).toBe(false)
}, 60_000)

test('concurrent processes recover from an abandoned lock without duplicating', async () => {
  const directory = useTemporaryConfig()
  holdLock(directory, { stale: true })

  const outcomes = await claimFromProcesses(directory, 4, claimAndRecordWorker)

  // Recovering an abandoned lock can, under a stale-lock steal, briefly let two
  // recoverers mint distinct payment ids (a diverged claim is then refused at
  // its next compare-and-swap — see the save test below). What must hold is the
  // outcome that prevents a double charge: exactly ONE process establishes the
  // checkout, and the abandoned lock is freed.
  expect(outcomes.filter(outcome => outcome === 'won')).toHaveLength(1)
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toMatch(/^token-\d+$/)
  expect(existsSync(lockPathFor(directory))).toBe(false)
}, 60_000)

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

test('saving reports whether the compare-and-swap write landed', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  const record = {
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'session-token',
  }

  // Matching intent and payment session: the write lands.
  expect(saveAimlapiTopupState(record)).toBe(true)

  // A different intent must not overwrite another checkout's record.
  expect(
    saveAimlapiTopupState({ ...record, email: 'other@example.com' }),
  ).toBe(false)
  // A stale payment session (another flow re-claimed) is rejected too.
  expect(
    saveAimlapiTopupState({ ...record, paymentSessionId: 'other-session' }),
  ).toBe(false)
  // The rejected writes left the stored record untouched.
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('session-token')

  // With no state at all there is nothing to swap against.
  clearAimlapiTopupState({ ...intent, paymentSessionId: claimed.paymentSessionId })
  expect(saveAimlapiTopupState(record)).toBe(false)
})

test('resetting a terminal session keeps the retained key, model and settled flag', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  expect(
    saveAimlapiTopupState({
      ...intent,
      paymentSessionId: claimed.paymentSessionId,
      resumeSessionToken: 'dead-session',
      apiKey: 'k_retained',
      apiKeyId: 'id_retained',
      model: 'gpt-4o',
      settled: false,
    }),
  ).toBe(true)

  const reset = resetAimlapiCheckoutSession({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
  })

  // A fresh payment session, but the issued key and provisioning choices survive
  // in the returned receipt - not only on disk.
  expect(reset?.paymentSessionId).toBeTruthy()
  expect(reset?.paymentSessionId).not.toBe(claimed.paymentSessionId)
  expect(reset?.resumeSessionToken).toBe('')
  expect(reset?.apiKey).toBe('k_retained')
  expect(reset?.apiKeyId).toBe('id_retained')
  expect(reset?.model).toBe('gpt-4o')
  expect(reset?.settled).toBe(false)
  // The returned receipt matches what a re-read from disk reports.
  expect(loadAimlapiTopupState(intent)).toEqual(reset!)
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

test('saving merges retained fields instead of dropping them', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  expect(
    saveAimlapiTopupState({
      ...intent,
      paymentSessionId: claimed.paymentSessionId,
      resumeSessionToken: 'session',
      apiKey: 'k_issued',
      apiKeyId: 'id_issued',
      model: 'gpt-4o',
    }),
  ).toBe(true)

  // A later partial update carries no key fields. Overwriting verbatim would
  // wipe the issued credential and make the next run mint a second key.
  expect(
    saveAimlapiTopupState({
      ...intent,
      paymentSessionId: claimed.paymentSessionId,
      resumeSessionToken: 'refreshed',
    }),
  ).toBe(true)

  const stored = loadAimlapiTopupState(intent)
  expect(stored?.resumeSessionToken).toBe('refreshed')
  expect(stored?.apiKey).toBe('k_issued')
  expect(stored?.apiKeyId).toBe('id_issued')
  expect(stored?.model).toBe('gpt-4o')
})

test('claiming a different intent refuses to discard an issued key', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: '',
    apiKey: 'k_issued',
    apiKeyId: 'id_issued',
  })

  // A different amount is a different checkout; silently replacing the record
  // would discard a provisioned - possibly already paid for - credential.
  expect(() => claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })).toThrow(
    'still holds an issued key',
  )
  expect(loadAimlapiTopupState(intent)?.apiKey).toBe('k_issued')

  // Clearing it explicitly is the documented way to start over.
  clearAimlapiTopupState({ ...intent, paymentSessionId: claimed.paymentSessionId })
  expect(
    claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 }).paymentSessionId,
  ).toBeTruthy()
})

test('claiming a different intent refuses to abandon an open payable checkout', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)
  // Got as far as opening the payment page (a resume token) but no key yet.
  saveAimlapiTopupState({
    ...intent,
    paymentSessionId: claimed.paymentSessionId,
    resumeSessionToken: 'open-session',
  })

  // A different amount would strand that still-payable session and open a
  // second, separately chargeable checkout, so the claim is refused.
  expect(() => claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 })).toThrow(
    'still open for a different top-up',
  )
  expect(loadAimlapiTopupState(intent)?.resumeSessionToken).toBe('open-session')

  // Clearing it explicitly is the documented way to start over.
  clearAimlapiTopupState({ ...intent, paymentSessionId: claimed.paymentSessionId })
  expect(
    claimAimlapiTopupState({ ...intent, amountUsdMinor: 5000 }).paymentSessionId,
  ).toBeTruthy()
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

test('resetAimlapiCheckoutSession returns null for a non-matching or keyless session', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)

  // No retained key yet, so there is nothing to preserve.
  expect(
    resetAimlapiCheckoutSession({
      ...intent,
      paymentSessionId: claimed.paymentSessionId,
    }),
  ).toBeNull()

  expect(
    saveAimlapiTopupState({
      ...intent,
      paymentSessionId: claimed.paymentSessionId,
      resumeSessionToken: 'dead',
      apiKey: 'k',
      apiKeyId: 'id',
    }),
  ).toBe(true)
  // A different intent or payment session must not reset another checkout.
  expect(
    resetAimlapiCheckoutSession({
      ...intent,
      email: 'other@example.com',
      paymentSessionId: claimed.paymentSessionId,
    }),
  ).toBeNull()
  expect(
    resetAimlapiCheckoutSession({ ...intent, paymentSessionId: 'other-session' }),
  ).toBeNull()
})

test('a corrupt top-up state file reads as no state instead of crashing', () => {
  const directory = useTemporaryConfig()
  writeFileSync(join(directory, 'aimlapi-topup.json'), '{ not valid json', 'utf8')

  expect(loadAimlapiTopupState(intent)).toBeNull()
  // The flow recovers by claiming over the unusable file.
  expect(claimAimlapiTopupState(intent).paymentSessionId).toBeTruthy()
})

test('resuming with a differently-cased email reuses the same payment session', () => {
  useTemporaryConfig()
  const claimed = claimAimlapiTopupState(intent)

  const reclaimed = claimAimlapiTopupState({ ...intent, email: '  User@Example.COM  ' })
  expect(reclaimed.paymentSessionId).toBe(claimed.paymentSessionId)
  expect(
    loadAimlapiTopupState({ ...intent, email: 'USER@example.com' })?.paymentSessionId,
  ).toBe(claimed.paymentSessionId)
})

test('a malformed record is refused rather than persisted as unloadable', () => {
  useTemporaryConfig()

  // A negative amount and an empty email both fail the read guard; persisting
  // them would orphan the state, so the write must throw instead.
  expect(() => claimAimlapiTopupState({ ...intent, amountUsdMinor: -1 })).toThrow(
    'malformed',
  )
  expect(() => claimAimlapiTopupState({ ...intent, email: '   ' })).toThrow('malformed')
  // Neither attempt left a state file behind.
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('sign-in key cache round-trips by normalized email and clears', () => {
  const directory = useTemporaryConfig()

  expect(loadAimlapiSignInKey('User@Example.com')).toBeNull()

  saveAimlapiSignInKey('User@Example.com', 'k_signin', 'id_signin')
  // The cached key is a credential, so it must be owner-only like the top-up
  // state file.
  if (process.platform !== 'win32') {
    expect(statSync(join(directory, 'aimlapi-signin-key.json')).mode & 0o777).toBe(0o600)
  }
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

test('sign-in key clear leaves a newer cached record intact', () => {
  useTemporaryConfig()
  saveAimlapiSignInKey('user@example.com', 'k_signin', 'id_signin')

  // A concurrent flow replaced the cache with a newer key for another email.
  saveAimlapiSignInKey('other@example.com', 'k_other', 'id_other')

  // The stale completion for the original email/id must not delete it.
  clearAimlapiSignInKey('user@example.com', 'id_signin')
  expect(loadAimlapiSignInKey('other@example.com')).toEqual({
    apiKey: 'k_other',
    apiKeyId: 'id_other',
  })

  // The owning flow still clears its own record.
  clearAimlapiSignInKey('other@example.com', 'id_other')
  expect(loadAimlapiSignInKey('other@example.com')).toBeNull()
})

import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
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
  clearAimlapiTopupState,
  clearAimlapiSignInKey,
  loadAimlapiSignInKey,
  loadAimlapiTopupState,
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
}

const LOCK_STALE_MS = 30_000

function lockPathFor(directory: string): string {
  return join(directory, 'aimlapi-topup.json.lock')
}

/** Pre-create the lock file, optionally back-dating it past the stale window. */
function holdLock(directory: string, options: { stale: boolean; token?: string }): string {
  const lock = lockPathFor(directory)
  writeFileSync(lock, options.token ?? '9999.other-process-token', {
    encoding: 'utf8',
    mode: 0o600,
  })
  if (options.stale) {
    const past = new Date(Date.now() - LOCK_STALE_MS * 2)
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

// The put-back branch (a live lock written between the staleness check and the
// steal) is not reachable in-process: read -> rename -> read run synchronously
// in one tick, so no timer callback can interleave. Only a second process could
// hit it, which is out of scope for a unit test; the ownership token is what
// makes that path fail closed.

test('a fresh lock held by another process times out instead of corrupting state', () => {
  const directory = useTemporaryConfig()
  holdLock(directory, { stale: false })

  expect(() => claimAimlapiTopupState(intent)).toThrow(
    'Timed out waiting for the AI/ML API checkout state lock.',
  )
  // Nothing was written behind the held lock.
  expect(existsSync(join(directory, 'aimlapi-topup.json'))).toBe(false)
  // The other holder's lock is intact.
  expect(existsSync(lockPathFor(directory))).toBe(true)
}, 20_000)

/**
 * Run `claimAimlapiTopupState` for the same intent in N separate processes and
 * return the payment session each one ended up with. Real processes are the only
 * way to exercise the lock's cross-process ownership: in-process calls never
 * interleave inside the synchronous acquire/release sequence.
 */
async function claimFromProcesses(
  directory: string,
  count: number,
): Promise<string[]> {
  const script = join(directory, 'claim-worker.ts')
  // A raw absolute path is not a valid ESM specifier (on Windows it is also
  // backslash-separated), so hand the worker a file:// URL instead of relying on
  // the runtime tolerating a bare path.
  const modulePath = pathToFileURL(join(import.meta.dir, 'topupState.ts')).href
  writeFileSync(
    script,
    [
      `import { claimAimlapiTopupState } from ${JSON.stringify(modulePath)}`,
      `const intent = ${JSON.stringify(intent)}`,
      `process.stdout.write(claimAimlapiTopupState(intent).paymentSessionId)`,
    ].join('\n'),
    'utf8',
  )

  const workers = Array.from({ length: count }, () =>
    Bun.spawn(['bun', 'run', script], {
      env: { ...process.env, OPENCLAUDE_CONFIG_DIR: directory },
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  )

  return await Promise.all(
    workers.map(async worker => {
      const [out, err] = await Promise.all([
        new Response(worker.stdout).text(),
        new Response(worker.stderr).text(),
      ])
      const code = await worker.exited
      if (code !== 0) throw new Error(`worker failed (${code}): ${err}`)
      return out.trim()
    }),
  )
}

test('concurrent processes converge on a single payment session', async () => {
  const directory = useTemporaryConfig()

  const sessions = await claimFromProcesses(directory, 8)

  // Exactly one process may mint a payment session; the rest must adopt it.
  // Divergence here would mean a second checkout - the duplicate charge this
  // module exists to prevent.
  expect(sessions).toHaveLength(8)
  expect(new Set(sessions).size).toBe(1)
  expect(loadAimlapiTopupState(intent)?.paymentSessionId).toBe(sessions[0])
  // Every holder released its own lock.
  expect(existsSync(lockPathFor(directory))).toBe(false)
}, 60_000)

test('concurrent processes recover from an abandoned lock without duplicating', async () => {
  const directory = useTemporaryConfig()
  holdLock(directory, { stale: true })

  const sessions = await claimFromProcesses(directory, 6)

  // Recovery must free the abandoned lock exactly once and still serialize the
  // claim, rather than letting several processes through at once.
  expect(new Set(sessions).size).toBe(1)
  expect(loadAimlapiTopupState(intent)?.paymentSessionId).toBe(sessions[0])
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

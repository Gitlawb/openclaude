import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type AimlapiTopupIntent = {
  email: string
  amountUsdMinor: number
  autoTopUp: boolean
  partnerId: string
  partnerName: string
  appBaseUrl: string
  inferenceBaseUrl: string
}

export type AimlapiPersistedTopup = AimlapiTopupIntent & {
  paymentSessionId: string
  resumeSessionToken: string
  /**
   * Existing-account key issued for this intent, retained so an interrupted
   * checkout resumes on the same credential instead of minting another key.
   */
  apiKey?: string
  apiKeyId?: string
  /**
   * Model chosen for this provisioning; retained with the settled receipt so a
   * resumed profile write configures the original model instead of recomputing
   * it from (possibly different) retry arguments.
   */
  model?: string
  /**
   * Set once payment/exchange has completed and `apiKey` is the final
   * provisioned credential. The next run then resumes the profile write with
   * that key instead of re-provisioning a one-shot-exchanged (now stranded)
   * session.
   */
  settled?: boolean
}

type AimlapiCheckoutState = Pick<
  AimlapiPersistedTopup,
  | 'paymentSessionId'
  | 'resumeSessionToken'
  | 'apiKey'
  | 'apiKeyId'
  | 'model'
  | 'settled'
>

function statePath(): string {
  return join(getClaudeConfigHomeDir(), 'aimlapi-topup.json')
}

const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 5_000
const LOCK_STALE_MS = 30_000
const INTENT_KEYS: ReadonlyArray<keyof AimlapiTopupIntent> = [
  'email',
  'amountUsdMinor',
  'autoTopUp',
  'partnerId',
  'partnerName',
  'appBaseUrl',
  'inferenceBaseUrl',
]

function waitForLock(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS)
}

function withStateLock<T>(operation: () => T, target: string = statePath()): T {
  const lockPath = `${target}.lock`
  mkdirSync(dirname(target), { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  // Ownership token written into the lock so recovery can tell this holder's
  // lock apart from a replacement another process wrote after stealing a stale
  // lock.
  const token = `${process.pid}.${randomUUID()}`
  let held = false

  while (!held) {
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600)
      try {
        writeFileSync(descriptor, token, { encoding: 'utf8' })
      } finally {
        closeSync(descriptor)
      }
      held = true
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined
      if (code !== 'EEXIST') throw error
      // Read identity and age from the same observation, so staleness and the
      // token refer to one instance of the lock.
      let observedToken: string
      let observedMtimeMs: number
      try {
        observedToken = readFileSync(lockPath, 'utf8')
        observedMtimeMs = statSync(lockPath).mtimeMs
      } catch {
        // Vanished between the failed create and the read; retry immediately.
        continue
      }
      if (Date.now() - observedMtimeMs > LOCK_STALE_MS) {
        // Recovery never renames the lock away and never puts one back. Moving a
        // live lock — even briefly — empties the pathname so a third process can
        // acquire it, and a crash mid-recovery would orphan the holder's lock;
        // restoring by rename would then replace whatever it acquired. Instead,
        // re-read the token immediately before unlinking so only the exact
        // abandoned instance is removed: a lock created or refreshed meanwhile
        // carries a different token and is left untouched.
        let released = false
        try {
          if (readFileSync(lockPath, 'utf8') === observedToken) {
            rmSync(lockPath, { force: true })
            released = true
          }
        } catch {
          // Already gone; the create below will race for it normally.
          released = true
        }
        // Two racers may both unlink the same abandoned lock; that is harmless
        // because only one can then win the exclusive create.
        if (released) continue
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the AI/ML API checkout state lock.')
      }
      waitForLock()
    }
  }

  try {
    return operation()
  } finally {
    // Only remove a lock this holder still owns: if recovery replaced ours after
    // it went stale, deleting the replacement would admit a third process while
    // its owner is still mutating the checkout state. Node can only unlink by
    // pathname, so the token re-read immediately before the unlink is what binds
    // the removal to this holder; the remaining window is bounded by that pair
    // of calls and cannot be closed without an inode-aware unlink.
    try {
      if (readFileSync(lockPath, 'utf8') === token) {
        rmSync(lockPath, { force: true })
      }
    } catch {
      // Lock already released or replaced by another owner.
    }
  }
}

function matchesIntent(
  state: AimlapiPersistedTopup,
  intent: AimlapiTopupIntent,
): boolean {
  return INTENT_KEYS.every(key => state[key] === intent[key])
}

function isPersistedTopup(value: unknown): value is AimlapiPersistedTopup {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return (
    typeof state.email === 'string' &&
    typeof state.amountUsdMinor === 'number' &&
    Number.isSafeInteger(state.amountUsdMinor) &&
    typeof state.autoTopUp === 'boolean' &&
    typeof state.partnerId === 'string' &&
    typeof state.partnerName === 'string' &&
    typeof state.appBaseUrl === 'string' &&
    typeof state.inferenceBaseUrl === 'string' &&
    typeof state.paymentSessionId === 'string' &&
    Boolean(state.paymentSessionId.trim()) &&
    typeof state.resumeSessionToken === 'string' &&
    (state.apiKey === undefined || typeof state.apiKey === 'string') &&
    (state.apiKeyId === undefined || typeof state.apiKeyId === 'string') &&
    (state.model === undefined || typeof state.model === 'string') &&
    (state.settled === undefined || typeof state.settled === 'boolean')
  )
}

function readAimlapiTopupStateUnlocked(): AimlapiPersistedTopup | null {
  try {
    const state: unknown = JSON.parse(readFileSync(statePath(), 'utf8'))
    return isPersistedTopup(state) ? state : null
  } catch {
    return null
  }
}

/**
 * Write owner-only JSON atomically: a reader never observes a partial file, and
 * the temporary is removed even when the write or rename fails.
 */
function writeJsonAtomic(target: string, data: unknown): void {
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    chmodSync(temporary, 0o600)
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function writeAimlapiTopupStateUnlocked(state: AimlapiPersistedTopup): void {
  writeJsonAtomic(statePath(), state)
}

export function loadAimlapiTopupState(
  intent: AimlapiTopupIntent,
): AimlapiCheckoutState | null {
  const state = readAimlapiTopupStateUnlocked()
  if (!state || !matchesIntent(state, intent)) return null
  return {
    paymentSessionId: state.paymentSessionId,
    resumeSessionToken: state.resumeSessionToken,
    apiKey: state.apiKey,
    apiKeyId: state.apiKeyId,
    model: state.model,
    settled: state.settled,
  }
}

/**
 * Compare-and-swap: the write only lands while the stored record still belongs
 * to this intent and payment session. Returns whether it was persisted, so a
 * caller can tell an applied update from one dropped because another flow
 * claimed or reset the state first.
 */
export function saveAimlapiTopupState(state: AimlapiPersistedTopup): boolean {
  return withStateLock(() => {
    const current = readAimlapiTopupStateUnlocked()
    if (
      !current ||
      !matchesIntent(current, state) ||
      current.paymentSessionId !== state.paymentSessionId
    ) {
      return false
    }
    writeAimlapiTopupStateUnlocked(state)
    return true
  })
}

export function claimAimlapiTopupState(
  intent: AimlapiTopupIntent,
): AimlapiCheckoutState {
  return withStateLock(() => {
    const existing = readAimlapiTopupStateUnlocked()
    if (existing && matchesIntent(existing, intent)) {
      return {
        paymentSessionId: existing.paymentSessionId,
        resumeSessionToken: existing.resumeSessionToken,
        apiKey: existing.apiKey,
        apiKeyId: existing.apiKeyId,
        model: existing.model,
        settled: existing.settled,
      }
    }
    const claimed: AimlapiCheckoutState = {
      paymentSessionId: randomUUID(),
      resumeSessionToken: '',
    }
    writeAimlapiTopupStateUnlocked({ ...intent, ...claimed })
    return claimed
  })
}

/**
 * A terminal checkout (cancelled/expired/failed, or a dead session) invalidates
 * the payment session but not an already-issued existing-account key. Drop the
 * dead session/payment identifiers and mint a fresh payment session while
 * retaining the key, so the next run reuses the credential instead of minting
 * another. Returns the refreshed checkout, or null when no matching keyed state
 * exists (callers clear the state instead).
 */
export function resetAimlapiCheckoutSession(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): AimlapiCheckoutState | null {
  return withStateLock(() => {
    const current = readAimlapiTopupStateUnlocked()
    if (
      !current ||
      !matchesIntent(current, expected) ||
      current.paymentSessionId !== expected.paymentSessionId ||
      !current.apiKey?.trim()
    ) {
      return null
    }
    const next: AimlapiPersistedTopup = {
      ...current,
      paymentSessionId: randomUUID(),
      resumeSessionToken: '',
    }
    writeAimlapiTopupStateUnlocked(next)
    return {
      paymentSessionId: next.paymentSessionId,
      resumeSessionToken: next.resumeSessionToken,
      apiKey: next.apiKey,
      apiKeyId: next.apiKeyId,
      // `next` keeps these on disk, so return them too: a caller that works from
      // this result rather than re-reading must not lose the chosen model or the
      // settled marker.
      model: next.model,
      settled: next.settled,
    }
  })
}

export function clearAimlapiTopupState(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): void {
  withStateLock(() => {
    const current = readAimlapiTopupStateUnlocked()
    if (
      current &&
      matchesIntent(current, expected) &&
      current.paymentSessionId === expected.paymentSessionId
    ) {
      rmSync(statePath(), { force: true })
    }
  })
}

// --- Sign-in key cache ------------------------------------------------------
// The guided provider-manager mints an existing-account key at code sign-in,
// before the top-up amount (and therefore the full checkout intent) is known.
// This lightweight per-email cache retains that key so a restart before/without
// completing the checkout reuses it instead of minting another one.

type AimlapiSignInKey = { email: string; apiKey: string; apiKeyId: string }

function signInKeyPath(): string {
  return join(getClaudeConfigHomeDir(), 'aimlapi-signin-key.json')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// A cached receipt is only useful if it can bypass createKey, which needs both
// the key and its identifier; treat a record missing either as absent so the
// flow mints a fresh, complete credential rather than propagating an empty id.
function isSignInKey(value: unknown): value is AimlapiSignInKey {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.email === 'string' &&
    typeof record.apiKey === 'string' &&
    Boolean(record.apiKey.trim()) &&
    typeof record.apiKeyId === 'string' &&
    Boolean(record.apiKeyId.trim())
  )
}

function readSignInKeyUnlocked(): AimlapiSignInKey | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(signInKeyPath(), 'utf8'))
    return isSignInKey(raw) ? raw : null
  } catch {
    // Missing/corrupt cache: mint a fresh key.
    return null
  }
}

export function loadAimlapiSignInKey(
  email: string,
): { apiKey: string; apiKeyId: string } | null {
  const record = readSignInKeyUnlocked()
  if (!record || record.email !== normalizeEmail(email)) return null
  return { apiKey: record.apiKey, apiKeyId: record.apiKeyId }
}

export function saveAimlapiSignInKey(
  email: string,
  apiKey: string,
  apiKeyId: string,
): void {
  if (!apiKey.trim() || !apiKeyId.trim()) return
  const target = signInKeyPath()
  const record: AimlapiSignInKey = { email: normalizeEmail(email), apiKey, apiKeyId }
  withStateLock(() => writeJsonAtomic(target, record), target)
}

// Delete the cache only when it still holds the record this flow saved. A stale
// completion must not remove a newer key another concurrent flow cached for a
// different email, which would force that flow to mint a redundant key.
export function clearAimlapiSignInKey(email: string, apiKeyId: string): void {
  const target = signInKeyPath()
  withStateLock(() => {
    const record = readSignInKeyUnlocked()
    if (
      record &&
      record.email === normalizeEmail(email) &&
      record.apiKeyId === apiKeyId
    ) {
      rmSync(target, { force: true })
    }
  }, target)
}

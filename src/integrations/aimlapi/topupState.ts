import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import * as lockfile from '../../utils/lockfile.js'

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

export type AimlapiCheckoutState = Pick<
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
/** Owner-only file/dir modes; these records hold API credentials. */
const FILE_MODE = 0o600
const DIR_MODE = 0o700
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

function ensureOwnerOnlyDir(target: string): void {
  const dir = dirname(target)
  mkdirSync(dir, { recursive: true, mode: DIR_MODE })
  // mkdir's mode is masked by umask, and the directory may already exist with a
  // permissive mode, so tighten it explicitly. Best-effort: platforms without
  // POSIX modes (Windows) simply ignore this.
  try {
    chmodSync(dir, DIR_MODE)
  } catch {
    // No POSIX permissions to enforce here.
  }
}

/**
 * Serialize checkout-state mutations through the shared `proper-lockfile`
 * wrapper rather than a bespoke advisory lock: its mkdir-based acquire is atomic
 * and its release is ownership-aware, so a holder cannot delete a lock another
 * process re-acquired after ours went stale. We keep a retry-until-deadline loop
 * so contending callers converge on the single stored payment session instead of
 * failing outright.
 */
function withStateLock<T>(operation: () => T, target: string = statePath()): T {
  ensureOwnerOnlyDir(target)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let release: (() => void) | undefined
  while (!release) {
    try {
      release = lockfile.lockSync(target, {
        lockfilePath: `${target}.lock`,
        stale: LOCK_STALE_MS,
        // The state file may not exist yet on the first claim, so skip realpath.
        realpath: false,
        // The default handler rethrows from a timer (an unhandled exception).
        // Our critical sections are sub-millisecond, so a compromise only
        // follows an extreme stall; the release below already tolerates it.
        onCompromised: () => {},
      })
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined
      if (code !== 'ELOCKED') throw error
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the AI/ML API checkout state lock.')
      }
      waitForLock()
    }
  }
  try {
    return operation()
  } finally {
    try {
      release()
    } catch {
      // Already released, or the lock was compromised and re-acquired by another
      // owner; proper-lockfile will not delete a lock that is no longer ours.
    }
  }
}

function matchesIntent(
  state: AimlapiPersistedTopup,
  intent: AimlapiTopupIntent,
): boolean {
  // Compare email case/whitespace-insensitively, matching the sign-in cache, so
  // resuming with a differently-cased email reuses the same payment session
  // instead of minting a duplicate one.
  return INTENT_KEYS.every(key =>
    key === 'email'
      ? normalizeEmail(String(state[key])) === normalizeEmail(String(intent[key]))
      : state[key] === intent[key],
  )
}

function isPersistedTopup(value: unknown): value is AimlapiPersistedTopup {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return (
    // Required strings are non-empty and the amount is a non-negative integer.
    // Read-time and write-time invariants must match (writeAimlapiTopupState
    // Unlocked enforces the same guard): a record that fails here would persist
    // but load back as null, orphaning the state and forcing a duplicate
    // checkout.
    typeof state.email === 'string' &&
    Boolean(state.email.trim()) &&
    typeof state.amountUsdMinor === 'number' &&
    Number.isSafeInteger(state.amountUsdMinor) &&
    state.amountUsdMinor >= 0 &&
    typeof state.autoTopUp === 'boolean' &&
    typeof state.partnerId === 'string' &&
    Boolean(state.partnerId.trim()) &&
    typeof state.partnerName === 'string' &&
    typeof state.appBaseUrl === 'string' &&
    Boolean(state.appBaseUrl.trim()) &&
    typeof state.inferenceBaseUrl === 'string' &&
    Boolean(state.inferenceBaseUrl.trim()) &&
    typeof state.paymentSessionId === 'string' &&
    Boolean(state.paymentSessionId.trim()) &&
    typeof state.resumeSessionToken === 'string' &&
    // Optional key fields, when present, must be non-empty to be usable.
    (state.apiKey === undefined ||
      (typeof state.apiKey === 'string' && Boolean(state.apiKey.trim()))) &&
    (state.apiKeyId === undefined ||
      (typeof state.apiKeyId === 'string' && Boolean(state.apiKeyId.trim()))) &&
    (state.model === undefined || typeof state.model === 'string') &&
    (state.settled === undefined || typeof state.settled === 'boolean')
  )
}

function readJsonFile(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    // A missing file is genuinely "no state". A real fs failure (EACCES, EPERM,
    // ENOTDIR, ...) must NOT masquerade as absent state, or the flow could mint a
    // duplicate session/key on top of state it simply could not read.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
  try {
    return JSON.parse(text)
  } catch {
    // A corrupt file is unusable; treat it as no state rather than crashing.
    return null
  }
}

function readAimlapiTopupStateUnlocked(): AimlapiPersistedTopup | null {
  const state = readJsonFile(statePath())
  return isPersistedTopup(state) ? state : null
}

/**
 * Write owner-only JSON atomically: a reader never observes a partial file, and
 * the temporary is removed even when the write or rename fails.
 */
function writeJsonAtomic(target: string, data: unknown): void {
  ensureOwnerOnlyDir(target)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: FILE_MODE,
    })
    chmodSync(temporary, FILE_MODE)
    renameSync(temporary, target)
  } finally {
    // A cleanup failure must not replace the primary write/rename error
    // (e.g. ENOSPC, EACCES), which would hide the root cause.
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Temp file already gone or unremovable; keep the original error.
    }
  }
}

function writeAimlapiTopupStateUnlocked(state: AimlapiPersistedTopup): void {
  // Match write-time and read-time invariants: a record that isPersistedTopup
  // would reject (empty email, negative amount, ...) must fail loudly here
  // instead of persisting and later loading as null, which would orphan the
  // state and force a duplicate checkout.
  if (!isPersistedTopup(state)) {
    throw new Error('Refusing to persist a malformed AI/ML API checkout state.')
  }
  writeJsonAtomic(statePath(), state)
}

function toCheckoutState(state: AimlapiPersistedTopup): AimlapiCheckoutState {
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
 * The stored record, but only while it still belongs to the caller's intent and
 * payment session. This is the compare-and-swap precondition shared by save,
 * reset and clear.
 */
function matchingStateOrNull(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): AimlapiPersistedTopup | null {
  const current = readAimlapiTopupStateUnlocked()
  if (
    !current ||
    !matchesIntent(current, expected) ||
    current.paymentSessionId !== expected.paymentSessionId
  ) {
    return null
  }
  return current
}

export function loadAimlapiTopupState(
  intent: AimlapiTopupIntent,
): AimlapiCheckoutState | null {
  const state = readAimlapiTopupStateUnlocked()
  if (!state || !matchesIntent(state, intent)) return null
  return toCheckoutState(state)
}

/**
 * Compare-and-swap: the write only lands while the stored record still belongs
 * to this intent and payment session. Returns whether it was persisted, so a
 * caller can tell an applied update from one dropped because another flow
 * claimed or reset the state first.
 */
export function saveAimlapiTopupState(state: AimlapiPersistedTopup): boolean {
  return withStateLock(() => {
    if (!matchingStateOrNull(state)) return false
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
      return toCheckoutState(existing)
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
    const current = matchingStateOrNull(expected)
    if (!current || !current.apiKey?.trim()) return null
    const next: AimlapiPersistedTopup = {
      ...current,
      paymentSessionId: randomUUID(),
      resumeSessionToken: '',
    }
    writeAimlapiTopupStateUnlocked(next)
    // `next` keeps model/settled on disk, so return them too: a caller working
    // from this result rather than re-reading must not lose them.
    return toCheckoutState(next)
  })
}

export function clearAimlapiTopupState(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): void {
  withStateLock(() => {
    if (matchingStateOrNull(expected)) {
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
  const raw = readJsonFile(signInKeyPath())
  return isSignInKey(raw) ? raw : null
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
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !apiKey.trim() || !apiKeyId.trim()) return
  const target = signInKeyPath()
  const record: AimlapiSignInKey = { email: normalizedEmail, apiKey, apiKeyId }
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

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { logForDebugging } from '../../utils/debug.js'
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
  payBaseUrl: string
  verificationBaseUrl: string
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
// Short enough that a dead holder's lock is recoverable well within the deadline
// (our critical sections are sub-millisecond, so a live holder never approaches
// this; proper-lockfile also refreshes the mtime while held).
const LOCK_STALE_MS = 8_000
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
  'payBaseUrl',
  'verificationBaseUrl',
]

/**
 * proper-lockfile clears a stale lock with `rmdir` + `mkdir` and does not
 * re-check ownership in between, so two processes reclaiming the same abandoned
 * lock can surface a transient filesystem error instead of `ELOCKED` (observed:
 * `EPERM` on `rmdir` under Windows). Those mean contention, not failure - retry
 * until the deadline so exactly one winner emerges instead of killing the caller.
 */
const RETRYABLE_LOCK_CODES: ReadonlySet<string> = new Set([
  'ELOCKED',
  'EPERM',
  'EEXIST',
  'ENOENT',
  'ENOTEMPTY',
  'EBUSY',
])

/**
 * `ELOCKED` is ordinary contention. The rest are also produced by a genuine
 * permission or disk problem, which must not hide behind five seconds of quiet
 * retries followed by a generic timeout, so they are surfaced louder.
 */
const EXPECTED_CONTENTION_CODES: ReadonlySet<string> = new Set(['ELOCKED'])

// Jitter so racing acquirers do not retry in lockstep and collide again on the
// same steal window.
function jitteredLockDelay(): number {
  return LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS)
}

function waitForLock(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, jitteredLockDelay())
}

function lockOptions(target: string): Parameters<typeof lockfile.lockSync>[1] {
  return {
    lockfilePath: `${target}.lock`,
    stale: LOCK_STALE_MS,
    // The state file may not exist yet on the first claim, so skip realpath.
    realpath: false,
    onCompromised: (error: Error) => {
      logForDebugging(`AI/ML API checkout state lock compromised: ${error}`, {
        level: 'error',
      })
    },
  }
}

/**
 * Classify a lock-acquire error: return the code to retry on, or rethrow a
 * genuine permission/disk failure. Logs each distinct condition the first time
 * it is swallowed so a real failure is visible immediately instead of looking
 * like plain contention (logging every pass would bury it under ~100 lines).
 */
function classifyLockError(
  error: unknown,
  seenCodes: Set<string>,
  target: string,
): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined
  if (!code || !RETRYABLE_LOCK_CODES.has(code)) throw error
  if (!seenCodes.has(code)) {
    seenCodes.add(code)
    logForDebugging(
      `AI/ML API checkout state lock retrying after ${code} on ${target}`,
      { level: EXPECTED_CONTENTION_CODES.has(code) ? 'debug' : 'warn' },
    )
  }
  return code
}

function lockTimeoutError(code: string, retries: number): Error {
  return new Error(
    `Timed out waiting for the AI/ML API checkout state lock (last: ${code}, ${retries} retries).`,
  )
}

function ensureOwnerOnlyDir(target: string): void {
  const dir = dirname(target)
  // mkdirSync(recursive) returns the first directory it created, or undefined if
  // `dir` already existed.
  const created = mkdirSync(dir, { recursive: true, mode: DIR_MODE })
  // Only tighten a directory THIS flow created. OPENCLAUDE_CONFIG_DIR may point
  // at a pre-existing shared/project root (or `/`), and forcing that to 0700
  // would break other users of it — the state file's own 0600 mode protects the
  // credential regardless. (mkdir's mode is masked by umask, so re-apply it to
  // the directory we made. Best-effort: platforms without POSIX modes ignore it.)
  if (created !== undefined) {
    try {
      chmodSync(created, DIR_MODE)
    } catch {
      // No POSIX permissions to enforce here.
    }
  }
}

function logContendedAcquire(
  retries: number,
  startedAt: number,
  lastCode?: string,
): void {
  if (retries === 0) return
  logForDebugging(
    `AI/ML API checkout state lock contended: acquired after ${retries} retries in ${Date.now() - startedAt}ms (last: ${lastCode})`,
    { level: 'debug' },
  )
}

/**
 * Serialize checkout-state mutations through the shared `proper-lockfile`
 * wrapper rather than a bespoke advisory lock: its mkdir-based acquire is atomic
 * and its release is ownership-aware, so a holder cannot delete a lock another
 * process re-acquired after ours went stale. It retries until a deadline so
 * contending callers converge on the single stored payment session instead of
 * failing outright.
 */
function withStateLock<T>(operation: () => T, target: string = statePath()): T {
  ensureOwnerOnlyDir(target)
  const startedAt = Date.now()
  const deadline = startedAt + LOCK_TIMEOUT_MS
  let release: (() => void) | undefined
  let retries = 0
  let lastCode: string | undefined
  const seenCodes = new Set<string>()
  while (!release) {
    try {
      release = lockfile.lockSync(target, lockOptions(target))
    } catch (error) {
      lastCode = classifyLockError(error, seenCodes, target)
      retries += 1
      if (Date.now() >= deadline) throw lockTimeoutError(lastCode, retries)
      waitForLock()
    }
  }
  logContendedAcquire(retries, startedAt, lastCode)
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function matchesIntent(
  state: AimlapiPersistedTopup,
  intent: AimlapiTopupIntent,
): boolean {
  // Compare email case/whitespace-insensitively so resuming with a
  // differently-cased email reuses the same payment session instead of minting a
  // duplicate one.
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
    typeof state.payBaseUrl === 'string' &&
    Boolean(state.payBaseUrl.trim()) &&
    typeof state.verificationBaseUrl === 'string' &&
    Boolean(state.verificationBaseUrl.trim()) &&
    typeof state.paymentSessionId === 'string' &&
    Boolean(state.paymentSessionId.trim()) &&
    typeof state.resumeSessionToken === 'string' &&
    (state.apiKey === undefined ||
      (typeof state.apiKey === 'string' && Boolean(state.apiKey.trim()))) &&
    (state.apiKeyId === undefined ||
      (typeof state.apiKeyId === 'string' && Boolean(state.apiKeyId.trim()))) &&
    (state.model === undefined || typeof state.model === 'string') &&
    (state.settled === undefined || typeof state.settled === 'boolean')
  )
}

/**
 * Read the stored record, treating a missing OR unreadable/corrupt file as "no
 * state". Writes are atomic (temp + rename), so the live file is never a partial
 * write; a corrupt file therefore only arises from external tampering, and
 * overwriting it to start a fresh checkout is safe.
 */
function readAimlapiTopupStateUnlocked(): AimlapiPersistedTopup | null {
  const path = statePath()
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  return isPersistedTopup(raw) ? raw : null
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
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Temp file already gone or unremovable; keep the original error.
    }
  }
}

function writeAimlapiTopupStateUnlocked(state: AimlapiPersistedTopup): void {
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
 * to this intent and payment session. Retained key fields (`apiKey`, `apiKeyId`,
 * `model`, `settled`) are MERGED, not replaced, so omitting them preserves what
 * is already stored rather than wiping an already-issued credential.
 */
export function saveAimlapiTopupState(state: AimlapiPersistedTopup): void {
  withStateLock(() => {
    const current = matchingStateOrNull(state)
    if (!current) return
    writeAimlapiTopupStateUnlocked({
      ...state,
      apiKey: state.apiKey ?? current.apiKey,
      apiKeyId: state.apiKeyId ?? current.apiKeyId,
      model: state.model ?? current.model,
      settled: state.settled ?? current.settled,
    })
  })
}

/**
 * Atomic session election. Concurrent runs of the same intent + payment id
 * settle on a SINGLE payable checkout: the first writer wins, and a loser gets
 * the winner's token back so it can resume that session and abandon the one it
 * just opened instead of leaving two chargeable checkouts. Retained key fields
 * are merged (as in `saveAimlapiTopupState`). Returns the winning checkout state,
 * or null when the slot no longer belongs to this intent + payment id (a
 * reset/clear happened meanwhile).
 */
export function recordAimlapiCheckoutSession(
  state: AimlapiPersistedTopup,
): AimlapiCheckoutState | null {
  return withStateLock(() => {
    const current = matchingStateOrNull(state)
    if (!current) return null
    // A peer already recorded a session for this payment id: keep theirs so the
    // loser adopts the winning token instead of overwriting it.
    if (current.resumeSessionToken?.trim()) {
      return toCheckoutState(current)
    }
    const recorded: AimlapiPersistedTopup = {
      ...state,
      apiKey: state.apiKey ?? current.apiKey,
      apiKeyId: state.apiKeyId ?? current.apiKeyId,
      model: state.model ?? current.model,
      settled: state.settled ?? current.settled,
    }
    writeAimlapiTopupStateUnlocked(recorded)
    return toCheckoutState(recorded)
  })
}

/**
 * Adopt the stored checkout for this intent, or start a new one. This is a
 * single slot: claiming a different intent replaces the stored record (the
 * identity includes amount/partner/endpoints, so a changed intent is genuinely a
 * different checkout).
 */
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
  const path = signInKeyPath()
  if (!existsSync(path)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return isSignInKey(raw) ? raw : null
  } catch {
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

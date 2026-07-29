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
  /**
   * Payment rail (`card` / `crypto`). Part of the identity because it is bound
   * into the checkout via the reused `paymentSessionId` idempotency key: a
   * different rail must open its own checkout rather than adopt the prior one.
   */
  method: string
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
// Async acquisition retries past the stale window, so a lock orphaned by an
// interrupted holder is reclaimed once it goes stale rather than timing out
// while it is still fresh. The async wait yields, so a longer deadline does not
// block the caller.
const LOCK_TIMEOUT_ASYNC_MS = 15_000
// Short enough that a dead holder's lock is recoverable well within the async
// deadline (our critical sections are sub-millisecond, so a live holder never
// approaches this; proper-lockfile also refreshes the mtime while held).
const LOCK_STALE_MS = 8_000
/** Owner-only file/dir modes; these records hold API credentials. */
const FILE_MODE = 0o600
const DIR_MODE = 0o700
const INTENT_KEYS: ReadonlyArray<keyof AimlapiTopupIntent> = [
  'email',
  'amountUsdMinor',
  'autoTopUp',
  'method',
  'partnerId',
  'partnerName',
  'appBaseUrl',
  'inferenceBaseUrl',
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

// Synchronous back-off: blocks the calling thread. Only the sync lock path uses
// it (see the blocking caveat on withStateLock).
function waitForLock(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, jitteredLockDelay())
}

// Asynchronous back-off: yields to the event loop so an interactive caller (the
// Ink GUI top-up) stays responsive while it waits for a contended lock.
function delayForLock(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, jitteredLockDelay()))
}

function lockOptions(target: string): Parameters<typeof lockfile.lockSync>[1] {
  return {
    lockfilePath: `${target}.lock`,
    stale: LOCK_STALE_MS,
    // The state file may not exist yet on the first claim, so skip realpath.
    realpath: false,
    // The default handler rethrows from a timer (an unhandled exception). A
    // compromise means another process stole this lock as stale while we still
    // believed we held it, so two critical sections could have overlapped:
    // record it rather than swallowing it silently. Our sections are sub-
    // millisecond, so this needs a stall longer than LOCK_STALE_MS.
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
  // Name the condition we kept hitting: a timeout after ELOCKED is a busy peer,
  // while EPERM/EEXIST points at a stale-steal race worth chasing.
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

function logContendedAcquire(retries: number, startedAt: number, lastCode?: string): void {
  if (retries === 0) return
  // One line per contended acquire, not per retry: a fully contended wait loops
  // many times within the deadline, and logging each pass would bury the signal.
  logForDebugging(
    `AI/ML API checkout state lock contended: acquired after ${retries} retries in ${Date.now() - startedAt}ms (last: ${lastCode})`,
    { level: 'debug' },
  )
}

/**
 * Serialize checkout-state mutations through the shared `proper-lockfile`
 * wrapper rather than a bespoke advisory lock: its mkdir-based acquire is atomic
 * and its release is ownership-aware, so a holder cannot delete a lock another
 * process re-acquired after ours went stale. Both variants retry until a
 * deadline so contending callers converge on the single stored payment session
 * instead of failing outright.
 *
 * BLOCKING: this synchronous variant parks the calling thread (up to
 * `LOCK_TIMEOUT_MS`) via `Atomics.wait`, freezing timers, the Ink UI and SIGINT
 * for that long. Use it off the interactive path (the CLI's own tests and the
 * multi-process worker); the interactive top-up flow calls `withStateLockAsync`,
 * which yields while it waits and retries past the stale window so an
 * interrupted holder's lock is reclaimed rather than timing out while fresh.
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

/**
 * Non-blocking counterpart to `withStateLock` for the interactive top-up flow.
 * It acquires with the same synchronous, timer-free `lockSync` (a single mkdir,
 * sub-millisecond), but on contention YIELDS via `await` between retries instead
 * of parking the thread, so the Ink UI, timers and SIGINT stay live. Its longer
 * deadline covers the stale window so a lock orphaned by an interrupted holder
 * is reclaimed once stale instead of timing out while it is still fresh.
 *
 * It deliberately avoids `proper-lockfile.lock` (the async acquire): that keeps
 * a periodic mtime-refresh timer alive for the lock's lifetime, and our sub-
 * millisecond sections never need refreshing — the lingering timer only stalls
 * callers (and test runs) with no benefit.
 */
async function withStateLockAsync<T>(
  operation: () => T,
  target: string = statePath(),
): Promise<T> {
  ensureOwnerOnlyDir(target)
  const startedAt = Date.now()
  const deadline = startedAt + LOCK_TIMEOUT_ASYNC_MS
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
      await delayForLock()
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
    typeof state.method === 'string' &&
    Boolean(state.method.trim()) &&
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

function corruptCheckoutStateError(path: string): Error {
  return new Error(
    `The AI/ML API checkout state at ${path} is unreadable or corrupt. A top-up may ` +
      `be in progress; inspect it and, once you are sure no checkout is pending, ` +
      `remove the file to start over.`,
  )
}

function readAimlapiTopupStateUnlocked(): AimlapiPersistedTopup | null {
  const path = statePath()
  const raw = readJsonFile(path)
  if (raw === null) {
    // readJsonFile returns null for both an absent file and an unparseable one.
    // A genuinely absent file is a fresh start, but a present-but-unparseable one
    // must FAIL CLOSED: treating it as absent would let a claim overwrite an
    // open/paid checkout or an exchanged key and open a second chargeable one.
    if (existsSync(path)) throw corruptCheckoutStateError(path)
    return null
  }
  // Parseable but schema-invalid is the same hazard — refuse rather than discard.
  if (!isPersistedTopup(raw)) throw corruptCheckoutStateError(path)
  return raw
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
 *
 * Retained fields (`apiKey`, `apiKeyId`, `model`, `settled`) are MERGED, not
 * replaced: omitting them preserves what is already stored. A partial update
 * would otherwise wipe an already-issued credential and make the next run mint a
 * second key — the duplicate this module exists to prevent. Pass an explicit
 * value to change one.
 */
function saveStateOperation(state: AimlapiPersistedTopup): boolean {
  const current = matchingStateOrNull(state)
  if (!current) return false
  writeAimlapiTopupStateUnlocked({
    ...state,
    apiKey: state.apiKey ?? current.apiKey,
    apiKeyId: state.apiKeyId ?? current.apiKeyId,
    model: state.model ?? current.model,
    settled: state.settled ?? current.settled,
  })
  return true
}

export function saveAimlapiTopupState(state: AimlapiPersistedTopup): boolean {
  return withStateLock(() => saveStateOperation(state))
}

/** Non-blocking `saveAimlapiTopupState` for the interactive top-up flow. */
export function saveAimlapiTopupStateAsync(
  state: AimlapiPersistedTopup,
): Promise<boolean> {
  return withStateLockAsync(() => saveStateOperation(state))
}

/**
 * Record the resume token for a just-created checkout session — but only while
 * no token is stored yet for this payment id. This is a compare-and-swap on the
 * token being empty, distinct from `saveAimlapiTopupState` which overwrites it.
 *
 * It lets two processes racing the same intent (they converge on one payment id
 * via `claimAimlapiTopupState`, then each opens a session before either records
 * one) settle on a SINGLE payable checkout: the first writer wins, and the
 * loser gets the winner's token back so it can resume that session and abandon
 * the one it just opened instead of leaving two chargeable checkouts. Returns
 * the winning checkout state, or null if the slot no longer belongs to this
 * intent + payment id (a reset/clear happened meanwhile).
 */
function recordCheckoutSessionOperation(
  state: AimlapiPersistedTopup,
): AimlapiCheckoutState | null {
  const current = matchingStateOrNull(state)
  if (!current) return null
  // A peer already recorded a session for this payment id: keep theirs.
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
}

export function recordAimlapiCheckoutSession(
  state: AimlapiPersistedTopup,
): AimlapiCheckoutState | null {
  return withStateLock(() => recordCheckoutSessionOperation(state))
}

/** Non-blocking `recordAimlapiCheckoutSession` for the interactive top-up flow. */
export function recordAimlapiCheckoutSessionAsync(
  state: AimlapiPersistedTopup,
): Promise<AimlapiCheckoutState | null> {
  return withStateLockAsync(() => recordCheckoutSessionOperation(state))
}

/**
 * Adopt the stored checkout for this intent, or start a new one.
 *
 * This is a single slot: claiming a different intent replaces the stored record.
 * It refuses to do so while that record still carries an issued key, because
 * silently discarding a provisioned (possibly already paid for) credential is
 * worse than making the caller decide — clear it explicitly with
 * `clearAimlapiTopupState` to start over.
 */
function claimStateOperation(intent: AimlapiTopupIntent): AimlapiCheckoutState {
  const existing = readAimlapiTopupStateUnlocked()
  if (existing && matchesIntent(existing, intent)) {
    return toCheckoutState(existing)
  }
  // Reaching here means a stored record exists for a DIFFERENT intent (a
  // matching one returned above). Refuse to silently discard it while it still
  // represents value in flight:
  if (existing?.apiKey?.trim()) {
    throw new Error(
      'An unfinished AI/ML API checkout still holds an issued key. Finish it, or ' +
        'discard the checkout (CLI: `openclaude aimlapi reset`; or Start over in ' +
        'the provider manager) before starting a different one.',
    )
  }
  if (existing?.resumeSessionToken?.trim()) {
    // A payable session is still open on the provider. Overwriting the slot would
    // strand that payment page and open a second, separately chargeable checkout.
    // If that session has since gone terminal (cancelled/expired), this claim has
    // no client to notice — so point the user at the explicit discard escape
    // hatch rather than silently abandoning it.
    throw new Error(
      'An unfinished AI/ML API checkout is still open for a different top-up. ' +
        'Finish it, or discard the checkout (CLI: `openclaude aimlapi reset`; or ' +
        'Start over in the provider manager) before starting another.',
    )
  }
  const claimed: AimlapiCheckoutState = {
    paymentSessionId: randomUUID(),
    resumeSessionToken: '',
  }
  writeAimlapiTopupStateUnlocked({ ...intent, ...claimed })
  // Backstop for a racing claimer: if the lock was stolen as stale by two
  // processes at once (upstream proper-lockfile removes a stale lock without
  // re-checking ownership), the last write wins. Return what is actually
  // persisted so both callers converge on one payment session instead of each
  // trusting the id it minted.
  const persisted = readAimlapiTopupStateUnlocked()
  return persisted && matchesIntent(persisted, intent)
    ? toCheckoutState(persisted)
    : claimed
}

export function claimAimlapiTopupState(
  intent: AimlapiTopupIntent,
): AimlapiCheckoutState {
  return withStateLock(() => claimStateOperation(intent))
}

/** Non-blocking `claimAimlapiTopupState` for the interactive top-up flow. */
export function claimAimlapiTopupStateAsync(
  intent: AimlapiTopupIntent,
): Promise<AimlapiCheckoutState> {
  return withStateLockAsync(() => claimStateOperation(intent))
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

function clearStateOperation(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): void {
  if (matchingStateOrNull(expected)) {
    rmSync(statePath(), { force: true })
  }
}

export function clearAimlapiTopupState(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): void {
  withStateLock(() => clearStateOperation(expected))
}

/** Non-blocking `clearAimlapiTopupState` for the interactive top-up flow. */
export function clearAimlapiTopupStateAsync(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): Promise<void> {
  return withStateLockAsync(() => clearStateOperation(expected))
}

/**
 * Outcome of a discard: the checkout was removed, kept because it holds an
 * unsaved issued key (a settled receipt), or there was nothing stored.
 */
export type AimlapiDiscardResult = 'discarded' | 'kept-settled' | 'none'

function discardStateOperation(force: boolean): AimlapiDiscardResult {
  const path = statePath()
  if (!existsSync(path)) return 'none'
  // Read leniently (readJsonFile, not the fail-closed reader): a settled record
  // is the ONLY copy of a paid-for, one-shot key that the provider will not
  // re-issue. Refuse to delete it unless the caller forces the discard —
  // otherwise "start over" would strand the credential. A corrupt or non-settled
  // record has no recoverable key, so it is safe to remove.
  const raw = readJsonFile(path)
  const holdsUnsavedKey =
    isPersistedTopup(raw) && Boolean(raw.settled) && Boolean(raw.apiKey?.trim())
  if (holdsUnsavedKey && !force) return 'kept-settled'
  rmSync(path, { force: true })
  return 'discarded'
}

/**
 * Discard the stored checkout, whatever intent it holds — including an
 * unreadable/corrupt file. This is the explicit "start over" escape hatch
 * surfaced to the CLI and GUI: an interrupted checkout whose session went
 * terminal keeps a resume token that blocks a *different* top-up (see
 * `claimAimlapiTopupState`), and a corrupt file fails closed on read; both can
 * only be cleared out of band. Prefer `clearAimlapiTopupState` for the normal,
 * intent-scoped retirement after a completed top-up.
 *
 * A SETTLED receipt (one holding an issued key not yet written to a profile) is
 * kept — deleting it would lose the paid-for key — unless `force` is set.
 */
export function discardAimlapiCheckoutState(force = false): AimlapiDiscardResult {
  return withStateLock(() => discardStateOperation(force))
}

/** Non-blocking `discardAimlapiCheckoutState` for the interactive top-up flow. */
export function discardAimlapiCheckoutStateAsync(
  force = false,
): Promise<AimlapiDiscardResult> {
  return withStateLockAsync(() => discardStateOperation(force))
}

// --- Sign-in key cache ------------------------------------------------------
// The guided provider-manager mints an existing-account key at code sign-in,
// before the top-up amount (and therefore the full checkout intent) is known.
// This lightweight per-email cache retains that key so a restart before/without
// completing the checkout reuses it instead of minting another one.
//
// SCOPE: this is a persistence primitive for that guided passwordless flow,
// which lands in a follow-up PR. It has no in-tree consumer in this stack yet
// (only its own tests), and is deliberately NOT re-exported from ./index.js
// until the flow that mints the key is wired — see the note there.

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

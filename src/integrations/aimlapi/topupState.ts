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
  /**
   * Whether this checkout must be exchanged for a fresh key (a paid sign-up
   * checkout). Persisted so a retry that now resolves to sign-in still exchanges
   * the paid session instead of minting an unrelated key and stranding it.
   */
  exchange?: boolean
  /**
   * Exchange lease. The one-shot key exchange is not idempotent, so exactly one
   * process may run it for a given payment id. The owner claims the lease under
   * the state lock before the network call; a peer that sees a fresh foreign
   * lease waits for the resulting settled receipt instead of exchanging too. A
   * lease older than `EXCHANGE_LEASE_STALE_MS` belonged to a crashed holder and
   * is reclaimable.
   */
  exchangeLeaseOwner?: string
  exchangeLeaseAt?: number
}

export type AimlapiCheckoutState = Pick<
  AimlapiPersistedTopup,
  | 'paymentSessionId'
  | 'resumeSessionToken'
  | 'apiKey'
  | 'apiKeyId'
  | 'model'
  | 'settled'
  | 'exchange'
>

function statePath(): string {
  return join(getClaudeConfigHomeDir(), 'aimlapi-topup.json')
}

const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 5_000
// The interactive (Ink) flow waits for the lock without blocking timers, the UI,
// or SIGINT, so it can afford a longer ceiling than the sync path.
const LOCK_TIMEOUT_ASYNC_MS = 15_000
// Short enough that a dead holder's lock is recoverable well within the deadline
// (our critical sections are sub-millisecond, so a live holder never approaches
// this; proper-lockfile also refreshes the mtime while held).
const LOCK_STALE_MS = 8_000
// A fresh exchange lease means a live peer is mid-exchange; older than this it
// belonged to a crashed holder and is reclaimable. Generous: the exchange is a
// single remote POST, but a slow network must not orphan the one-shot session.
const EXCHANGE_LEASE_STALE_MS = 75_000
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

// Non-blocking counterpart of waitForLock for the interactive flow: yields to the
// event loop between retries instead of freezing timers, the Ink UI, and SIGINT.
function delayForLock(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, jitteredLockDelay()))
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

/**
 * Async counterpart of withStateLock for the interactive (Ink) flow: it awaits
 * between lock retries so a contended lock never freezes timers, the UI, or
 * SIGINT while it waits.
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
    (state.settled === undefined || typeof state.settled === 'boolean') &&
    (state.exchange === undefined || typeof state.exchange === 'boolean') &&
    (state.exchangeLeaseOwner === undefined ||
      (typeof state.exchangeLeaseOwner === 'string' &&
        Boolean(state.exchangeLeaseOwner.trim()))) &&
    (state.exchangeLeaseAt === undefined ||
      (typeof state.exchangeLeaseAt === 'number' && Number.isFinite(state.exchangeLeaseAt)))
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
    exchange: state.exchange,
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
      // An empty key id/key is a "not applicable" sentinel (e.g. the existing-key
      // top-up path), NOT a value to persist: the reader rejects empty strings, so
      // a serialized "" would make the whole receipt unreadable and lose an
      // otherwise-recoverable checkout. Coerce it to absent instead.
      apiKey: state.apiKey?.trim() || current.apiKey,
      apiKeyId: state.apiKeyId?.trim() || current.apiKeyId,
      model: state.model ?? current.model,
      settled: state.settled ?? current.settled,
      exchange: state.exchange ?? current.exchange,
      exchangeLeaseOwner: state.exchangeLeaseOwner ?? current.exchangeLeaseOwner,
      exchangeLeaseAt: state.exchangeLeaseAt ?? current.exchangeLeaseAt,
    })
  })
}

/**
 * Record a completed one-shot key exchange (apiKey/apiKeyId + settled) under the
 * same async lock/CAS, MERGING over the stored record so the resume token and
 * intent survive. The exchange-lease winner calls this BEFORE it returns the key,
 * so a crash after the non-idempotent /exchange can still recover the paid key
 * from the receipt instead of re-running (and being rejected by) the spent
 * exchange. Clears the lease — a settled receipt supersedes it. No-op when the
 * slot no longer belongs to this intent + payment id (a reset/clear happened).
 */
export function recordAimlapiSettledKeyAsync(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
  key: { apiKey: string; apiKeyId?: string; model?: string },
): Promise<void> {
  return withStateLockAsync(() => {
    const current = matchingStateOrNull(expected)
    if (!current) return
    const apiKey = key.apiKey.trim() || current.apiKey?.trim()
    // Never settle without a credential: marking the receipt settled and clearing
    // the lease with no key would make a peer resume from a receipt that holds
    // nothing while the one-shot /exchange is already spent. Leave the record
    // (and its lease) untouched so a retry can still exchange.
    if (!apiKey) return
    writeAimlapiTopupStateUnlocked({
      ...current,
      apiKey,
      apiKeyId: key.apiKeyId?.trim() || current.apiKeyId,
      model: key.model?.trim() || current.model,
      settled: true,
      exchangeLeaseOwner: undefined,
      exchangeLeaseAt: undefined,
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
      exchange: state.exchange ?? current.exchange,
      exchangeLeaseOwner: state.exchangeLeaseOwner ?? current.exchangeLeaseOwner,
      exchangeLeaseAt: state.exchangeLeaseAt ?? current.exchangeLeaseAt,
    }
    writeAimlapiTopupStateUnlocked(recorded)
    return toCheckoutState(recorded)
  })
}

/**
 * Adopt the stored checkout for this intent, or start a new one. This is a single
 * slot, so claiming a DIFFERENT intent would replace the stored record. That is
 * safe for a never-advanced claim, but it must NOT silently drop a checkout that
 * still holds recoverable value — an opened session (a resume token, which may
 * already be PAID but not yet exchanged) or a settled key not yet written to a
 * profile. Dropping the resume token there strands a paid session/key that is
 * only reachable through this record, so a changed intent is refused until the
 * caller finishes or cancels the retained checkout (re-running the SAME intent
 * resumes it). The identity includes amount/partner/endpoints, so a changed
 * intent is genuinely a different checkout.
 *
 * `abandonExisting` overrides that refusal for a caller that has already gotten
 * an explicit, out-of-band user confirmation to abandon the retained checkout
 * (e.g. a re-edited amount the user chose to submit anyway). The overwrite still
 * happens under this same lock acquisition, so the caller never observes a
 * window where the slot is cleared but not yet re-claimed.
 */
export function claimAimlapiTopupState(
  intent: AimlapiTopupIntent,
  options: { abandonExisting?: boolean } = {},
): AimlapiCheckoutState {
  return withStateLock(() => {
    const existing = readAimlapiTopupStateUnlocked()
    if (existing && matchesIntent(existing, intent)) {
      return toCheckoutState(existing)
    }
    if (
      !options.abandonExisting &&
      existing &&
      (Boolean(existing.resumeSessionToken?.trim()) ||
        existing.settled === true ||
        Boolean(existing.apiKey?.trim()))
    ) {
      const priorUsd = (existing.amountUsdMinor / 100).toFixed(2)
      throw new Error(
        `An earlier AI/ML API top-up of $${priorUsd} hasn't finished and may already be ` +
          `paid. Re-run that same top-up to complete it (or cancel it) before starting a ` +
          `different one.`,
      )
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

/**
 * Non-blocking clear for the interactive flow. Runs in a synchronous Ink save
 * callback where the sync lock would freeze the UI on contention, so it awaits
 * the lock instead. Callers treat it as best-effort (the receipt is a resume aid).
 */
export function clearAimlapiTopupStateAsync(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
): Promise<void> {
  return withStateLockAsync(() => {
    if (matchingStateOrNull(expected)) {
      rmSync(statePath(), { force: true })
    }
  })
}

/**
 * Outcome of an exchange-lease acquisition (see `exchangeLeaseOwner`):
 * - `acquired`: the caller holds the lease and is the sole process cleared to
 *   run the one-shot key exchange.
 * - `settled`: a peer already exchanged and recorded the key — resume from it.
 * - `held`: a live peer holds a fresh lease and is exchanging — wait for its
 *   settled receipt rather than exchanging in parallel.
 * - `gone`: the checkout for this intent + payment id was cleared/reset meanwhile.
 */
export type AimlapiExchangeLease =
  | { status: 'acquired'; state: AimlapiCheckoutState }
  | { status: 'settled'; state: AimlapiCheckoutState }
  | { status: 'held'; owner: string; ageMs: number }
  | { status: 'gone' }

function acquireExchangeLeaseOperation(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
  owner: string,
): AimlapiExchangeLease {
  const current = matchingStateOrNull(expected)
  if (!current) return { status: 'gone' }
  // A peer already completed the one-shot exchange and recorded the key.
  if (current.settled && current.apiKey?.trim()) {
    return { status: 'settled', state: toCheckoutState(current) }
  }
  const now = Date.now()
  const leaseOwner = current.exchangeLeaseOwner
  const heldAt = current.exchangeLeaseAt
  // A lease timestamped in the FUTURE cannot describe a live holder on this
  // machine (all processes share the wall clock), so it comes from a backwards
  // clock jump or a hand-edited state file. Treat it — like a non-numeric value —
  // as an expired lease to reclaim, not a fresh one: a negative age would read as
  // perpetually fresh and clamping it to 0 would still pin the slot until real
  // time crawled up to the bogus timestamp (hours, or years). Reclaiming is safe:
  // a genuinely live holder's parallel /exchange is caught server-side.
  const ageMs =
    typeof heldAt === 'number' && heldAt <= now ? now - heldAt : Number.POSITIVE_INFINITY
  // A fresh lease held by another process: it is exchanging right now, so back
  // off. A stale lease (crashed holder) or our own is reclaimed below.
  if (
    typeof leaseOwner === 'string' &&
    leaseOwner !== owner &&
    ageMs < EXCHANGE_LEASE_STALE_MS
  ) {
    return { status: 'held', owner: leaseOwner, ageMs }
  }
  // No fresh foreign lease (absent, already ours, or stale): claim it. Writing
  // under the state lock is the compare-and-swap that elects a single exchanger.
  writeAimlapiTopupStateUnlocked({
    ...current,
    exchangeLeaseOwner: owner,
    exchangeLeaseAt: now,
  })
  return { status: 'acquired', state: toCheckoutState(current) }
}

/**
 * Elect a single process to perform the non-idempotent key exchange for a
 * checkout, serializing racing same-intent processes onto one exchange. See
 * `AimlapiExchangeLease`. Async so it never blocks the Ink event loop.
 */
export function acquireAimlapiExchangeLeaseAsync(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
  owner: string,
): Promise<AimlapiExchangeLease> {
  return withStateLockAsync(() => acquireExchangeLeaseOperation(expected, owner))
}

function releaseExchangeLeaseOperation(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
  owner: string,
): void {
  const current = matchingStateOrNull(expected)
  // Only clear a lease we still own and that a settled receipt has not already
  // superseded — never one a peer re-claimed after ours went stale.
  if (!current || current.exchangeLeaseOwner !== owner || current.settled) return
  writeAimlapiTopupStateUnlocked({
    ...current,
    exchangeLeaseOwner: undefined,
    exchangeLeaseAt: undefined,
  })
}

/**
 * Release the exchange lease after a FAILED exchange (the key was not minted, or
 * the outcome is unknown) so a retry proceeds promptly instead of waiting out the
 * stale window. Best-effort and ownership-aware. Never called on success — the
 * settled receipt supersedes the lease there.
 */
export function releaseAimlapiExchangeLeaseAsync(
  expected: AimlapiTopupIntent & Pick<AimlapiPersistedTopup, 'paymentSessionId'>,
  owner: string,
): Promise<void> {
  return withStateLockAsync(() => releaseExchangeLeaseOperation(expected, owner))
}

// --- Sign-in key cache ------------------------------------------------------
// The guided provider-manager mints an existing-account key at code sign-in,
// before the top-up amount (and therefore the full checkout intent) is known.
// This lightweight per-email cache retains that key so a restart before/without
// completing the checkout reuses it instead of minting another one.

type AimlapiSignInKeyEntry = { apiKey: string; apiKeyId: string }
// Email-keyed collection so concurrent/interrupted sign-ins for different
// accounts never overwrite each other's recovery key.
type AimlapiSignInKeyStore = Record<string, AimlapiSignInKeyEntry>

function signInKeyPath(): string {
  return join(getClaudeConfigHomeDir(), 'aimlapi-signin-key.json')
}

// A cached receipt is only useful if it can bypass createKey, which needs both
// the key and its identifier; treat an entry missing either as absent so the
// flow mints a fresh, complete credential rather than propagating an empty id.
function isSignInKeyEntry(value: unknown): value is AimlapiSignInKeyEntry {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.apiKey === 'string' &&
    Boolean(record.apiKey.trim()) &&
    typeof record.apiKeyId === 'string' &&
    Boolean(record.apiKeyId.trim())
  )
}

function readSignInKeyStoreUnlocked(): AimlapiSignInKeyStore {
  const path = signInKeyPath()
  if (!existsSync(path)) return {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return {}
    const record = raw as Record<string, unknown>
    // Migrate a pre-collection single-record file `{ email, apiKey, apiKeyId }`.
    const legacyEmail = record.email
    if (typeof legacyEmail === 'string' && isSignInKeyEntry(record)) {
      return {
        [normalizeEmail(legacyEmail)]: {
          apiKey: record.apiKey,
          apiKeyId: record.apiKeyId,
        },
      }
    }
    const store: AimlapiSignInKeyStore = {}
    for (const [email, entry] of Object.entries(record)) {
      if (email && isSignInKeyEntry(entry)) {
        store[email] = { apiKey: entry.apiKey, apiKeyId: entry.apiKeyId }
      }
    }
    return store
  } catch {
    return {}
  }
}

export function loadAimlapiSignInKey(
  email: string,
): { apiKey: string; apiKeyId: string } | null {
  const entry = readSignInKeyStoreUnlocked()[normalizeEmail(email)]
  return entry ? { apiKey: entry.apiKey, apiKeyId: entry.apiKeyId } : null
}

export function saveAimlapiSignInKey(
  email: string,
  apiKey: string,
  apiKeyId: string,
): void {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !apiKey.trim() || !apiKeyId.trim()) return
  const target = signInKeyPath()
  withStateLock(() => {
    const store = readSignInKeyStoreUnlocked()
    store[normalizedEmail] = { apiKey, apiKeyId }
    writeJsonAtomic(target, store)
  }, target)
}

// Delete only this email's entry, and only when it still holds the key this flow
// cached, so a stale completion cannot remove a newer key another concurrent
// flow cached for the same account.
export function clearAimlapiSignInKey(email: string, apiKeyId: string): void {
  const target = signInKeyPath()
  const normalizedEmail = normalizeEmail(email)
  withStateLock(() => {
    const store = readSignInKeyStoreUnlocked()
    if (store[normalizedEmail]?.apiKeyId !== apiKeyId) return
    delete store[normalizedEmail]
    if (Object.keys(store).length === 0) {
      rmSync(target, { force: true })
    } else {
      writeJsonAtomic(target, store)
    }
  }, target)
}

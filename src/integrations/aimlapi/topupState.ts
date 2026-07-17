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
}

type AimlapiCheckoutState = Pick<
  AimlapiPersistedTopup,
  'paymentSessionId' | 'resumeSessionToken' | 'apiKey' | 'apiKeyId'
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
  'payBaseUrl',
  'verificationBaseUrl',
]

function waitForLock(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS)
}

function withStateLock<T>(operation: () => T): T {
  const target = statePath()
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
      let stale = false
      try {
        const lock = statSync(lockPath)
        stale = Date.now() - lock.mtimeMs > LOCK_STALE_MS
      } catch {
        // Lock vanished between open and stat; retry the create immediately.
        continue
      }
      if (stale) {
        // Record the token we observed as stale so recovery can prove it is
        // discarding the SAME lock and not a live replacement written between
        // the staleness check and the steal.
        let observedToken: string | undefined
        try {
          observedToken = readFileSync(lockPath, 'utf8')
        } catch {
          // Vanished already; retry the create immediately.
          continue
        }
        const stealPath = `${lockPath}.${token}.stale`
        let stolen = false
        try {
          // Atomic: only one racer can rename a given inode away.
          renameSync(lockPath, stealPath)
          stolen = true
        } catch {
          // Another racer already claimed it, or a live holder keeps it open
          // (Windows cannot rename an open file); fall through to the wait.
        }
        if (stolen) {
          let stolenToken: string | undefined
          try {
            stolenToken = readFileSync(stealPath, 'utf8')
          } catch {
            // Already gone; nothing to revalidate.
          }
          if (stolenToken === undefined || stolenToken === observedToken) {
            // Exactly the stale lock we observed (or already gone): drop it.
            rmSync(stealPath, { force: true })
            continue
          }
          // A live replacement slipped in and we renamed it away. Fail closed:
          // put it back and wait rather than remove a lock we do not own.
          try {
            renameSync(stealPath, lockPath)
          } catch {
            rmSync(stealPath, { force: true })
          }
        }
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
    // Only remove a lock this holder still owns. A stale-lock steal may have
    // replaced ours with another process's lock; deleting that would admit a
    // third process while the second still mutates the checkout state.
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
    typeof state.payBaseUrl === 'string' &&
    typeof state.verificationBaseUrl === 'string' &&
    typeof state.paymentSessionId === 'string' &&
    Boolean(state.paymentSessionId.trim()) &&
    typeof state.resumeSessionToken === 'string' &&
    (state.apiKey === undefined || typeof state.apiKey === 'string') &&
    (state.apiKeyId === undefined || typeof state.apiKeyId === 'string')
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

function writeAimlapiTopupStateUnlocked(state: AimlapiPersistedTopup): void {
  const target = statePath()
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
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
  }
}

export function saveAimlapiTopupState(state: AimlapiPersistedTopup): void {
  withStateLock(() => {
    const current = readAimlapiTopupStateUnlocked()
    if (
      !current ||
      !matchesIntent(current, state) ||
      current.paymentSessionId !== state.paymentSessionId
    ) {
      return
    }
    writeAimlapiTopupStateUnlocked(state)
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

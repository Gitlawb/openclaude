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
}

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
  let descriptor: number | undefined

  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined
      if (code !== 'EEXIST') throw error
      try {
        const lock = statSync(lockPath)
        if (Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true })
          continue
        }
      } catch {
        continue
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
    closeSync(descriptor)
    rmSync(lockPath, { force: true })
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
    typeof state.resumeSessionToken === 'string'
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
): Pick<AimlapiPersistedTopup, 'paymentSessionId' | 'resumeSessionToken'> | null {
  const state = readAimlapiTopupStateUnlocked()
  if (!state || !matchesIntent(state, intent)) return null
  return {
    paymentSessionId: state.paymentSessionId,
    resumeSessionToken: state.resumeSessionToken,
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
): Pick<AimlapiPersistedTopup, 'paymentSessionId' | 'resumeSessionToken'> {
  return withStateLock(() => {
    const existing = readAimlapiTopupStateUnlocked()
    if (existing && matchesIntent(existing, intent)) {
      return {
        paymentSessionId: existing.paymentSessionId,
        resumeSessionToken: existing.resumeSessionToken,
      }
    }
    const claimed = {
      paymentSessionId: randomUUID(),
      resumeSessionToken: '',
    }
    writeAimlapiTopupStateUnlocked({ ...intent, ...claimed })
    return claimed
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

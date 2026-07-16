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

export type AimlapiTopupIntent = {
  email: string
  amountUsdMinor: number
  autoTopUp: boolean
  partnerId: string
  partnerName: string
  appBaseUrl: string
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

function matchesIntent(
  state: AimlapiPersistedTopup,
  intent: AimlapiTopupIntent,
): boolean {
  return (Object.keys(intent) as Array<keyof AimlapiTopupIntent>).every(
    key => state[key] === intent[key],
  )
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
    typeof state.payBaseUrl === 'string' &&
    typeof state.verificationBaseUrl === 'string' &&
    typeof state.paymentSessionId === 'string' &&
    Boolean(state.paymentSessionId.trim()) &&
    typeof state.resumeSessionToken === 'string'
  )
}

export function loadAimlapiTopupState(
  intent: AimlapiTopupIntent,
): Pick<AimlapiPersistedTopup, 'paymentSessionId' | 'resumeSessionToken'> | null {
  try {
    const state: unknown = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (!isPersistedTopup(state) || !matchesIntent(state, intent)) return null
    return {
      paymentSessionId: state.paymentSessionId,
      resumeSessionToken: state.resumeSessionToken,
    }
  } catch {
    return null
  }
}

export function saveAimlapiTopupState(state: AimlapiPersistedTopup): void {
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

export function clearAimlapiTopupState(intent: AimlapiTopupIntent): void {
  const current = loadAimlapiTopupState(intent)
  if (current) rmSync(statePath(), { force: true })
}

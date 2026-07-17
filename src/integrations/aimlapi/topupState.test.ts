import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import {
  claimAimlapiTopupState,
  clearAimlapiTopupState,
  clearAimlapiSignInKey,
  loadAimlapiSignInKey,
  loadAimlapiTopupState,
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
  payBaseUrl: 'https://pay.example.test',
  verificationBaseUrl: 'https://front.example.test',
}

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
  useTemporaryConfig()

  expect(loadAimlapiSignInKey('User@Example.com')).toBeNull()

  saveAimlapiSignInKey('User@Example.com', 'k_signin', 'id_signin')
  // Lookup is case/whitespace-insensitive on the email.
  expect(loadAimlapiSignInKey('user@example.com')).toEqual({
    apiKey: 'k_signin',
    apiKeyId: 'id_signin',
  })
  // A different email must not read this key.
  expect(loadAimlapiSignInKey('other@example.com')).toBeNull()

  clearAimlapiSignInKey()
  expect(loadAimlapiSignInKey('user@example.com')).toBeNull()
})

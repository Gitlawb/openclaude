import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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

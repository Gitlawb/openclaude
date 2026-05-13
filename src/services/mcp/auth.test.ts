import assert from 'node:assert/strict'
import test from 'node:test'

import { validateOAuthCallbackParams } from './auth.js'

test('OAuth callback rejects error parameters before state validation can be bypassed', () => {
  const result = validateOAuthCallbackParams(
    {
      error: 'access_denied',
      error_description: 'denied by provider',
    },
    'expected-state',
  )

  assert.deepEqual(result, { type: 'state_mismatch' })
})

test('OAuth callback accepts provider errors only when state matches', () => {
  const result = validateOAuthCallbackParams(
    {
      state: 'expected-state',
      error: 'access_denied',
      error_description: 'denied by provider',
      error_uri: 'https://example.test/error',
    },
    'expected-state',
  )

  assert.deepEqual(result, {
    type: 'error',
    error: 'access_denied',
    errorDescription: 'denied by provider',
    errorUri: 'https://example.test/error',
    message:
      'OAuth error: access_denied - denied by provider (See: https://example.test/error)',
  })
})

test('OAuth callback accepts authorization codes only when state matches', () => {
  assert.deepEqual(
    validateOAuthCallbackParams(
      {
        state: 'expected-state',
        code: 'auth-code',
      },
      'expected-state',
    ),
    { type: 'code', code: 'auth-code' },
  )

  assert.deepEqual(
    validateOAuthCallbackParams(
      {
        state: 'wrong-state',
        code: 'auth-code',
      },
      'expected-state',
    ),
    { type: 'state_mismatch' },
  )
})

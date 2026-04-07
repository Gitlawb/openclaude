import assert from 'node:assert/strict'
import test from 'node:test'

import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from './crypto.ts'

test('generateCodeChallenge returns the RFC 7636 S256 challenge', async () => {
  const challenge = await generateCodeChallenge(
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  )
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('generateCodeVerifier returns a URL-safe random string', () => {
  const verifier = generateCodeVerifier()
  assert.match(verifier, /^[A-Za-z0-9_-]+$/)
  assert.ok(verifier.length >= 43)
})

test('generateState returns a URL-safe random string', () => {
  const state = generateState()
  assert.match(state, /^[A-Za-z0-9_-]+$/)
  assert.ok(state.length >= 43)
})

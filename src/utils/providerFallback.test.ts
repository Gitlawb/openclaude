import { expect, test } from 'bun:test'

import { type ProviderProfile } from './config.js'
import {
  getProviderFallbackChain,
  resolveNextFallbackProvider,
  resolveNextFallbackProviderFromState,
} from './providerFallback.js'

// This file intentionally avoids mock.module(). The functions under test take
// their settings/profile inputs as injected parameters, so tests pass them
// directly. bun does not unregister mock.module() overrides on mock.restore(),
// so mocking shared singletons here used to leak into later test files
// (attribution/preconnect/etc.). Dependency injection keeps these tests fully
// self-contained.

function buildProfile(
  overrides: Partial<ProviderProfile> = {},
): ProviderProfile {
  return {
    id: 'profile_x',
    name: 'X',
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    model: 'example-model',
    apiKey: 'sk-x',
    ...overrides,
  }
}

test('getProviderFallbackChain: returns [] when unset', () => {
  expect(getProviderFallbackChain({})).toEqual([])
})

test('getProviderFallbackChain: returns configured ids', () => {
  expect(
    getProviderFallbackChain({
      providerFallbackChain: ['profile_a', 'profile_b'],
    }),
  ).toEqual(['profile_a', 'profile_b'])
})

test('getProviderFallbackChain: filters non-string + empty entries', () => {
  // Setting could be hand-edited to a malformed shape. Defensive filter keeps
  // the resolver from crashing on garbage without making it the source of a
  // hard error during a rate-limit recovery flow.
  expect(
    getProviderFallbackChain({
      providerFallbackChain: ['profile_a', '', null, 5, 'profile_b'],
    }),
  ).toEqual(['profile_a', 'profile_b'])
})

test('resolveNextFallbackProvider: empty chain → null', () => {
  expect(resolveNextFallbackProvider('profile_a', [], [])).toBeNull()
})

test('resolveNextFallbackProvider: returns next after active', () => {
  const a = buildProfile({ id: 'profile_a', name: 'A' })
  const b = buildProfile({ id: 'profile_b', name: 'B' })

  const result = resolveNextFallbackProvider(
    'profile_a',
    ['profile_a', 'profile_b'],
    [a, b],
  )
  expect(result?.nextProfileId).toBe('profile_b')
  expect(result?.nextProfile.name).toBe('B')
  expect(result?.fromProfileId).toBe('profile_a')
})

test('resolveNextFallbackProvider: does not wrap when active is the last entry', () => {
  // Wrapping would let "everything rate-limited" cycle back to the first
  // profile that already failed and produce a churn loop. Exhaust silently
  // and let the caller surface the original error.
  const a = buildProfile({ id: 'profile_a' })
  const b = buildProfile({ id: 'profile_b' })

  const result = resolveNextFallbackProvider(
    'profile_b',
    ['profile_a', 'profile_b'],
    [a, b],
  )
  expect(result).toBeNull()
})

test('resolveNextFallbackProvider: active not in chain → starts from chain[0]', () => {
  // User landed on a non-chain profile via `/provider` ad-hoc — treat the
  // chain as an absolute priority list and start from the top instead of
  // refusing to do anything.
  const a = buildProfile({ id: 'profile_a' })
  const b = buildProfile({ id: 'profile_b' })
  const c = buildProfile({ id: 'profile_c' })

  const result = resolveNextFallbackProvider(
    'profile_c',
    ['profile_a', 'profile_b'],
    [a, b, c],
  )
  expect(result?.nextProfileId).toBe('profile_a')
  expect(result?.fromProfileId).toBe('profile_c')
})

test('resolveNextFallbackProvider: skips chain entries that no longer resolve to real profiles', () => {
  // Chain may reference a deleted profile id. Don't surface that as a hard
  // failure — keep advancing.
  const a = buildProfile({ id: 'profile_a' })
  const c = buildProfile({ id: 'profile_c' })

  const result = resolveNextFallbackProvider(
    'profile_a',
    ['profile_a', 'profile_missing', 'profile_c'],
    [a, c],
  )
  expect(result?.nextProfileId).toBe('profile_c')
})

test('resolveNextFallbackProvider: null active + chain configured → chain[0]', () => {
  // Edge case: pristine session with no active profile yet. The chain still
  // serves as a priority list so the first entry wins.
  const a = buildProfile({ id: 'profile_a' })

  const result = resolveNextFallbackProvider(null, ['profile_a'], [a])
  expect(result?.nextProfileId).toBe('profile_a')
  expect(result?.fromProfileId).toBeNull()
})

test('resolveNextFallbackProvider: every candidate missing → null', () => {
  const result = resolveNextFallbackProvider(
    'profile_a',
    ['profile_a', 'profile_b'],
    [], // no profiles exist
  )
  expect(result).toBeNull()
})

test('resolveNextFallbackProviderFromState: resolves from injected chain + active', () => {
  const a = buildProfile({ id: 'profile_a' })
  const b = buildProfile({ id: 'profile_b' })

  const result = resolveNextFallbackProviderFromState({
    activeProfileId: 'profile_a',
    chain: ['profile_a', 'profile_b'],
    profiles: [a, b],
  })

  expect(result?.nextProfileId).toBe('profile_b')
  expect(result?.fromProfileId).toBe('profile_a')
})

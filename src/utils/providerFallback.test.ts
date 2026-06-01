import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import {
  resetSettingsCache,
  setSessionSettingsCache,
} from './settings/settingsCache.js'

import * as actualConfig from './config.js'
import * as actualProviderProfiles from './providerProfiles.js'
import * as actualSettings from './settings/settings.js'

function buildProfile(
  overrides: Partial<actualConfig.ProviderProfile> = {},
): actualConfig.ProviderProfile {
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

async function importFreshProviderFallback(
  profileMocks: Partial<typeof actualProviderProfiles>,
  settingsOverride: Record<string, unknown> = {},
) {
  mock.restore()
  mock.module('./providerProfiles.js', () => ({
    ...actualProviderProfiles,
    ...profileMocks,
  }))
  // Stub `getSettings_DEPRECATED` directly so the resolver sees the test's
  // intended `providerFallbackChain` regardless of session-cache reset
  // behavior under nonced re-imports. setSessionSettingsCache() works under
  // bun locally but doesn't survive a fresh `import('?ts=...')` because the
  // settings module loads its own cache instance on each fresh import.
  mock.module('./settings/settings.js', () => ({
    ...actualSettings,
    getSettings_DEPRECATED: () => settingsOverride,
    getInitialSettings: () => settingsOverride,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./providerFallback.js?ts=${nonce}`)
}

beforeEach(() => {
  mock.restore()
  setSessionSettingsCache({ settings: {}, errors: [] })
})

afterEach(() => {
  mock.restore()
  resetSettingsCache()
})

test('getProviderFallbackChain: returns [] when unset', async () => {
  const { getProviderFallbackChain } = await importFreshProviderFallback({})
  expect(getProviderFallbackChain()).toEqual([])
})

test('getProviderFallbackChain: returns configured ids', async () => {
  const { getProviderFallbackChain } = await importFreshProviderFallback(
    {},
    { providerFallbackChain: ['profile_a', 'profile_b'] },
  )
  expect(getProviderFallbackChain()).toEqual(['profile_a', 'profile_b'])
})

test('getProviderFallbackChain: filters non-string + empty entries', async () => {
  // Setting could be hand-edited to a malformed shape. Defensive filter keeps
  // the resolver from crashing on garbage without making it the source of a
  // hard error during a rate-limit recovery flow.
  const { getProviderFallbackChain } = await importFreshProviderFallback(
    {},
    {
      providerFallbackChain: ['profile_a', '', null, 5, 'profile_b'],
    },
  )
  expect(getProviderFallbackChain()).toEqual(['profile_a', 'profile_b'])
})

test('resolveNextFallbackProvider: empty chain → null', async () => {
  const { resolveNextFallbackProvider } = await importFreshProviderFallback({})
  expect(resolveNextFallbackProvider('profile_a', [], [])).toBeNull()
})

test('resolveNextFallbackProvider: returns next after active', async () => {
  const a = buildProfile({ id: 'profile_a', name: 'A' })
  const b = buildProfile({ id: 'profile_b', name: 'B' })
  const { resolveNextFallbackProvider } = await importFreshProviderFallback({})

  const result = resolveNextFallbackProvider(
    'profile_a',
    ['profile_a', 'profile_b'],
    [a, b],
  )
  expect(result?.nextProfileId).toBe('profile_b')
  expect(result?.nextProfile.name).toBe('B')
  expect(result?.fromProfileId).toBe('profile_a')
})

test('resolveNextFallbackProvider: does not wrap when active is the last entry', async () => {
  // Wrapping would let "everything rate-limited" cycle back to the first
  // profile that already failed and produce a churn loop. Exhaust silently
  // and let the caller surface the original error.
  const a = buildProfile({ id: 'profile_a' })
  const b = buildProfile({ id: 'profile_b' })
  const { resolveNextFallbackProvider } = await importFreshProviderFallback({})

  const result = resolveNextFallbackProvider(
    'profile_b',
    ['profile_a', 'profile_b'],
    [a, b],
  )
  expect(result).toBeNull()
})

test('resolveNextFallbackProvider: active not in chain → starts from chain[0]', async () => {
  // User landed on a non-chain profile via `/provider` ad-hoc — treat the
  // chain as an absolute priority list and start from the top instead of
  // refusing to do anything.
  const a = buildProfile({ id: 'profile_a' })
  const b = buildProfile({ id: 'profile_b' })
  const c = buildProfile({ id: 'profile_c' })
  const { resolveNextFallbackProvider } = await importFreshProviderFallback({})

  const result = resolveNextFallbackProvider(
    'profile_c',
    ['profile_a', 'profile_b'],
    [a, b, c],
  )
  expect(result?.nextProfileId).toBe('profile_a')
  expect(result?.fromProfileId).toBe('profile_c')
})

test('resolveNextFallbackProvider: skips chain entries that no longer resolve to real profiles', async () => {
  // Chain may reference a deleted profile id. Don't surface that as a hard
  // failure — keep advancing.
  const a = buildProfile({ id: 'profile_a' })
  const c = buildProfile({ id: 'profile_c' })
  const { resolveNextFallbackProvider } = await importFreshProviderFallback({})

  const result = resolveNextFallbackProvider(
    'profile_a',
    ['profile_a', 'profile_missing', 'profile_c'],
    [a, c],
  )
  expect(result?.nextProfileId).toBe('profile_c')
})

test('resolveNextFallbackProvider: null active + chain configured → chain[0]', async () => {
  // Edge case: pristine session with no active profile yet. The chain still
  // serves as a priority list so the first entry wins.
  const a = buildProfile({ id: 'profile_a' })
  const { resolveNextFallbackProvider } = await importFreshProviderFallback({})

  const result = resolveNextFallbackProvider(null, ['profile_a'], [a])
  expect(result?.nextProfileId).toBe('profile_a')
  expect(result?.fromProfileId).toBeNull()
})

test('resolveNextFallbackProvider: every candidate missing → null', async () => {
  const { resolveNextFallbackProvider } = await importFreshProviderFallback({})
  const result = resolveNextFallbackProvider(
    'profile_a',
    ['profile_a', 'profile_b'],
    [], // no profiles exist
  )
  expect(result).toBeNull()
})

test('resolveNextFallbackProviderFromState: pulls chain + active from real settings/state', async () => {
  const a = buildProfile({ id: 'profile_a' })
  const b = buildProfile({ id: 'profile_b' })
  const { resolveNextFallbackProviderFromState } =
    await importFreshProviderFallback(
      {
        getProviderProfiles: () => [a, b],
        getActiveProviderProfile: () => a,
      },
      { providerFallbackChain: ['profile_a', 'profile_b'] },
    )

  const result = resolveNextFallbackProviderFromState()
  expect(result?.nextProfileId).toBe('profile_b')
  expect(result?.fromProfileId).toBe('profile_a')
})

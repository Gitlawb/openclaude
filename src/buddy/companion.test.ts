import { afterAll, describe, expect, mock, test } from 'bun:test'
import type { StoredCompanion } from './types.js'
import { SPECIES } from './types.js'

// Mock the config module with a COMPLETE config (spread the real one) —
// bun's mock.module leaks across files in the same process, so a partial
// mock silently breaks unrelated suites (see repo testing conventions).
// The cache-busting query loads a second, unmocked instance of the module;
// spreading the plain specifier would capture the mock and recurse.
const actualConfig = await import(`../utils/config.js?real=${Date.now()}`)
let mockCompanion: StoredCompanion | undefined

mock.module('../utils/config.js', () => ({
  ...actualConfig,
  getGlobalConfig: () => ({
    ...actualConfig.getGlobalConfig(),
    userID: 'buddy-test-user',
    oauthAccount: undefined,
    companion: mockCompanion,
  }),
}))

const { getCompanion, rollWithSeed } = await import('./companion.js')

afterAll(() => {
  // mock.restore() does NOT undo mock.module() — re-register the real module
  // so the stub can't bleed into later test files in the same process.
  mock.module('../utils/config.js', () => actualConfig)
  mock.restore()
})

const SOUL: StoredCompanion = {
  name: 'Testbud',
  personality: 'Test personality.',
  hatchedAt: 1,
}

describe('getCompanion speciesOverride', () => {
  test('no override → deterministically rolled hero from the pool', () => {
    mockCompanion = SOUL
    const base = getCompanion()!
    expect(SPECIES as readonly string[]).toContain(base.species)
    // Deterministic: same user id → same species on every read.
    expect(getCompanion()!.species).toBe(base.species)
  })

  test('override changes species but not rarity/stats/eye', () => {
    mockCompanion = SOUL
    const base = getCompanion()!
    // Pick a hero that differs from the rolled one so the change is visible.
    const target = SPECIES.find(s => s !== base.species)!
    mockCompanion = { ...SOUL, speciesOverride: target }
    const overridden = getCompanion()!
    expect(overridden.species).toBe(target)
    expect(overridden.rarity).toBe(base.rarity)
    expect(overridden.eye).toBe(base.eye)
    expect(overridden.stats).toEqual(base.stats)
    expect(overridden.name).toBe(SOUL.name)
  })

  test('garbage override is ignored and falls back to the rolled species', () => {
    mockCompanion = SOUL
    const base = getCompanion()!
    mockCompanion = {
      ...SOUL,
      speciesOverride: 'unicorn' as StoredCompanion['speciesOverride'],
    }
    expect(getCompanion()!.species).toBe(base.species)
  })

  test('no companion stored → undefined regardless of override plumbing', () => {
    mockCompanion = undefined
    expect(getCompanion()).toBeUndefined()
  })
})

describe('deterministic roll pool', () => {
  test('rollWithSeed always lands in the hero pool and is stable per seed', () => {
    for (const seed of ['a', 'b', 'c', 'buddy', 'seed-42', 'kevin']) {
      const { bones } = rollWithSeed(seed)
      expect(SPECIES as readonly string[]).toContain(bones.species)
      expect(rollWithSeed(seed).bones.species).toBe(bones.species)
    }
  })
})

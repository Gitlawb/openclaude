import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realFastMode from './fastMode.js'

async function importFreshModelCost() {
  return import(`./modelCost.js?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/modelCost.modelGate.test.ts')
})

afterEach(() => {
  try {
    mock.restore()
    mock.module('./fastMode.js', () => realFastMode)
  } finally {
    releaseSharedMutationLock()
  }
})

test('unknown models do not inherit the configured default model price', async () => {
  mock.module('./model/model.js', () => ({
    firstPartyNameToCanonical: (model: string) => {
      if (model.includes('claude-haiku-4-5')) return 'claude-haiku-4-5'
      return model
    },
    getCanonicalName: (model: string) => {
      if (model.includes('claude-haiku-4-5')) return 'claude-haiku-4-5'
      return model
    },
    getDefaultMainLoopModelSetting: () => 'claude-haiku-4-5',
  }))
  const { getModelCosts, COST_HAIKU_45, COST_TIER_5_25 } =
    await importFreshModelCost()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = {} as any
  const costs = getModelCosts('meta/llama-3.3-70b-instruct', usage)

  expect(costs).toEqual(COST_TIER_5_25)
  expect(costs).not.toEqual(COST_HAIKU_45)
})

// Regression for #1769: fast mode is now enabled for Opus 4.8, but getModelCosts
// only applied the elevated fast-mode tier to opus-4-6, so fast-mode 4.8 was
// billed at the normal rate while the picker advertised the fast-mode price.
test('fast-mode Opus 4.8 is charged the elevated fast-mode tier, normal otherwise', async () => {
  mock.module('./fastMode.js', () => ({
    ...realFastMode,
    isFastModeEnabled: () => true,
  }))
  const { getModelCosts, COST_TIER_30_150, COST_TIER_5_25 } =
    await importFreshModelCost()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fast = { speed: 'fast' } as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const standard = { speed: 'standard' } as any

  expect(getModelCosts('claude-opus-4-8', fast)).toEqual(COST_TIER_30_150)
  expect(getModelCosts('claude-opus-4-8', standard)).toEqual(COST_TIER_5_25)
})

// MODEL_COSTS is a plain object, so a bare `MODEL_COSTS[shortName]` lookup
// inherits Object.prototype members. A model id of `constructor` or `__proto__`
// (both valid arbitrary ids for custom/OpenAI-compatible providers, and already
// lowercase so getCanonicalName returns them unchanged) resolved to a truthy
// prototype value, bypassing the `!costs` unknown-model guard: the cost math
// then read undefined fields and produced NaN, permanently poisoning the running
// session total, and getModelPricingString rendered "$NaN/$NaN per Mtok".
test('proto-member model ids fall through the unknown-model path, not NaN', async () => {
  mock.module('./model/model.js', () => ({
    firstPartyNameToCanonical: (model: string) => model,
    // Mirror the real canonicalizer for these names: both are lowercase and
    // match no Claude pattern, so they pass through verbatim.
    getCanonicalName: (model: string) => model,
    getDefaultMainLoopModelSetting: () => 'claude-haiku-4-5',
  }))
  const { getModelCosts, getModelPricingString, calculateUSDCost, COST_TIER_5_25 } =
    await importFreshModelCost()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  for (const name of ['constructor', '__proto__']) {
    // DEFAULT_UNKNOWN_MODEL_COST is COST_TIER_5_25 (see modelCost.ts).
    expect(getModelCosts(name, usage)).toEqual(COST_TIER_5_25)
    const cost = calculateUSDCost(name, usage)
    expect(Number.isNaN(cost)).toBe(false)
    expect(cost).toBeGreaterThan(0)
    expect(getModelPricingString(name)).toBeUndefined()
  }
})

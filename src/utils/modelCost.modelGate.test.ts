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

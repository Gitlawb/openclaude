/**
 * Integration test for cost-tracker → cacheStatsTracker wiring.
 *
 * The unit tests in services/api/cacheMetrics.test.ts and
 * services/api/cacheStatsTracker.test.ts verify that each piece works
 * in isolation. This file verifies that they're ACTUALLY CONNECTED —
 * that `addToTotalSessionCost` resolves the provider, extracts metrics,
 * and records them on the tracker on every call. Without this test, a
 * future refactor could silently unwire the call chain (wrong param
 * order, renamed symbol, removed call) and every individual unit test
 * would still pass while `/cache-stats` showed empty data.
 *
 * We use real state — `resetCostState` + `getCurrentTurnCacheMetrics` —
 * rather than mocking the tracker module. Fewer moving parts, and the
 * test fails for the right reason if anyone breaks the wrapping.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { addToTotalSessionCost, resetCostState } from './cost-tracker.js'
import {
  getCurrentTurnCacheMetrics,
  getSessionCacheMetrics,
} from './services/api/cacheStatsTracker.js'

// BetaUsage-compatible shape — minimum fields addToTotalSessionCost
// needs to run without throwing. Cache fields are the ones we care
// about here; input/output go into model cost calc.
function anthropicUsage(partial: {
  input?: number
  output?: number
  cacheRead?: number
  cacheCreation?: number
}): Parameters<typeof addToTotalSessionCost>[1] {
  return {
    input_tokens: partial.input ?? 0,
    output_tokens: partial.output ?? 0,
    cache_read_input_tokens: partial.cacheRead ?? 0,
    cache_creation_input_tokens: partial.cacheCreation ?? 0,
    // BetaUsage has several other optional fields; they're not read by
    // the cache-tracking path so we leave them undefined.
  } as Parameters<typeof addToTotalSessionCost>[1]
}

beforeEach(() => {
  // resetCostState is the wrapped version that ALSO clears the cache
  // tracker — this line is itself part of what we're verifying.
  resetCostState()
})

describe('addToTotalSessionCost → cacheStatsTracker wiring', () => {
  test('records normalized cache metrics on the tracker for each call', () => {
    addToTotalSessionCost(
      0.01,
      anthropicUsage({
        input: 200,
        output: 50,
        cacheRead: 800,
        cacheCreation: 100,
      }),
      'claude-sonnet-4',
    )

    const turn = getCurrentTurnCacheMetrics()
    expect(turn.supported).toBe(true)
    expect(turn.read).toBe(800)
    expect(turn.created).toBe(100)
    // total = fresh(200) + read(800) + created(100) = 1100
    expect(turn.total).toBe(1_100)
    // hitRate = read / total = 800 / 1100 ≈ 0.727
    expect(turn.hitRate).toBeCloseTo(800 / 1_100, 4)
  })

  test('session aggregate accumulates across multiple API calls', () => {
    addToTotalSessionCost(
      0.01,
      anthropicUsage({ input: 100, cacheRead: 400 }),
      'claude-sonnet-4',
    )
    addToTotalSessionCost(
      0.02,
      anthropicUsage({ input: 200, cacheRead: 600 }),
      'claude-sonnet-4',
    )

    const session = getSessionCacheMetrics()
    expect(session.read).toBe(1_000)
    // total = (100+400) + (200+600) = 1300
    expect(session.total).toBe(1_300)
    expect(session.hitRate).toBeCloseTo(1_000 / 1_300, 4)
  })

  test('cold turn (no cache read/created) still records as supported', () => {
    addToTotalSessionCost(
      0.005,
      anthropicUsage({ input: 500, output: 100 }),
      'claude-sonnet-4',
    )

    const turn = getCurrentTurnCacheMetrics()
    expect(turn.supported).toBe(true)
    expect(turn.read).toBe(0)
    expect(turn.created).toBe(0)
    expect(turn.total).toBe(500)
    // hitRate computed against a non-zero total is 0, not null — empty
    // cache on a cacheable provider is a legitimate "no-hit" signal.
    expect(turn.hitRate).toBe(0)
  })
})

describe('resetCostState wrapper also clears cache tracker', () => {
  test('resetCostState() zeros both cost counters and cache stats', () => {
    // Populate both systems
    addToTotalSessionCost(
      0.01,
      anthropicUsage({ input: 100, cacheRead: 500 }),
      'claude-sonnet-4',
    )
    expect(getSessionCacheMetrics().read).toBe(500)

    // resetCostState is the WRAPPED version — bootstrap's
    // resetCostState cleared cost state historically but not cache
    // stats. The wrapper in cost-tracker.ts adds the second call.
    resetCostState()

    const session = getSessionCacheMetrics()
    expect(session.read).toBe(0)
    expect(session.supported).toBe(false)
  })
})

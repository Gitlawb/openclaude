import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  clearBreakerTrippedState,
  getBreakerTripState,
  recordBreakerTripped,
} from './compactWarningState.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'

// These tests pin down the contract from issue #1373 follow-up:
//   - successful compaction (any path: auto session-memory, auto
//     traditional, manual /compact) clears the breaker-trip store;
//   - cache-only cleanup (resume/continue, /clear) MUST NOT clear
//     the breaker-trip store — only real compaction does.
//
// The previous funnel — calling `clearBreakerTrippedState()` from
// `runPostCompactCleanup()` — silently cleared recovery state on
// resume/continue without a real compaction, so the REPL/SDK showed
// "auto-compact recovered" when the breaker had not actually
// recovered. The fix moves the reset to the successful-compaction
// call sites only.

beforeEach(async () => {
  await acquireSharedMutationLock('services/compact/breakerTripReset.test.ts')
})

afterEach(() => {
  try {
    // Reset the breaker store between tests so prior state doesn't
    // leak. The store is module-level (singleton), so without this
    // teardown the next test could observe a tripped state.
    clearBreakerTrippedState()
  } finally {
    releaseSharedMutationLock()
  }
})

test('runPostCompactCleanup does NOT clear the breaker-trip store', () => {
  // Seed a tripped state — what `recordBreakerTripped` would do
  // inside autoCompact on a circuit-breaker trip. This is the
  // signal the REPL/SDK reads to show "auto-compact paused".
  recordBreakerTripped({
    failureCount: 3,
    trippedAtMs: Date.now() - 30_000,
  })
  expect(getBreakerTripState().tripped).toBe(true)

  // `runPostCompactCleanup` is also invoked from `clearSessionCaches`
  // on resume/continue, which is not a compaction event. The
  // cache-only path must NOT silently clear the breaker-trip store.
  runPostCompactCleanup()

  // Breaker is still tripped — recovery state survives cache-only
  // cleanup. This is the regression target: previously this would
  // report `tripped: false` even though no real compaction
  // succeeded.
  expect(getBreakerTripState().tripped).toBe(true)
  expect(getBreakerTripState().lastFailureCount).toBe(3)
})

test('runPostCompactCleanup does not clear breaker state on a subagent (agent:*) source', () => {
  recordBreakerTripped({
    failureCount: 3,
    trippedAtMs: Date.now(),
  })

  // Subagent compactions share module-level state with the main
  // thread. Passing a non-main-thread querySource still must not
  // clear the breaker store — the reset is gated on a successful
  // compaction, not on which thread the cleanup runs on. The
  // call-site guard in `autoCompact.ts` (which clears the state on
  // a real compaction success) is what protects against an agent
  // compact falsely reporting main-thread recovery.
  runPostCompactCleanup('agent:worker')

  expect(getBreakerTripState().tripped).toBe(true)
})

test('clearBreakerTrippedState is a no-op when no trip is recorded', () => {
  // Baseline: nothing tripped. The clear call must not throw or
  // mutate state in a way that would break subsequent reads.
  expect(getBreakerTripState().tripped).toBe(false)
  clearBreakerTrippedState()
  expect(getBreakerTripState().tripped).toBe(false)
})

test('clearBreakerTrippedState resets a tripped state to recovered', () => {
  // Direct test of the call-site guard. Successful-compaction call
  // sites (auto session-memory, auto traditional, manual /compact
  // session-memory, manual /compact traditional) call this directly;
  // this is the canonical "recovery" signal the REPL/SDK reads.
  recordBreakerTripped({
    failureCount: 3,
    trippedAtMs: Date.now() - 60_000,
  })
  expect(getBreakerTripState().tripped).toBe(true)

  clearBreakerTrippedState()
  expect(getBreakerTripState().tripped).toBe(false)
  expect(getBreakerTripState().trippedAtMs).toBeUndefined()
  expect(getBreakerTripState().lastFailureCount).toBeUndefined()
})

test('clearBreakerTrippedState preserves store identity (callers see fresh reads)', () => {
  // Sanity: clearing the store updates the in-place state object
  // returned by `getBreakerTripState`. Callers that have already
  // captured a reference to the state must see the cleared value
  // on a subsequent `getBreakerTripState()` call.
  recordBreakerTripped({
    failureCount: 3,
    trippedAtMs: Date.now(),
  })
  const before = getBreakerTripState()
  expect(before.tripped).toBe(true)

  clearBreakerTrippedState()
  const after = getBreakerTripState()
  expect(after.tripped).toBe(false)
})

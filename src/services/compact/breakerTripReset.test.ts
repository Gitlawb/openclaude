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
//
// P2: the breaker-trip store is keyed by session ID so multiple
// main-thread sessions in one process stay isolated.

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'

beforeEach(async () => {
  await acquireSharedMutationLock('services/compact/breakerTripReset.test.ts')
})

afterEach(() => {
  try {
    // Reset the breaker store for both test sessions so prior state
    // doesn't leak across tests.
    clearBreakerTrippedState(SESSION_A)
    clearBreakerTrippedState(SESSION_B)
  } finally {
    releaseSharedMutationLock()
  }
})

test('runPostCompactCleanup does NOT clear the breaker-trip store', () => {
  // Seed a tripped state — what `recordBreakerTripped` would do
  // inside autoCompact on a circuit-breaker trip. This is the
  // signal the REPL/SDK reads to show "auto-compact paused".
  recordBreakerTripped(SESSION_A, {
    failureCount: 3,
    trippedAtMs: Date.now() - 30_000,
  })
  expect(getBreakerTripState(SESSION_A).tripped).toBe(true)

  // `runPostCompactCleanup` is also invoked from `clearSessionCaches`
  // on resume/continue, which is not a compaction event. The
  // cache-only path must NOT silently clear the breaker-trip store.
  runPostCompactCleanup()

  // Breaker is still tripped — recovery state survives cache-only
  // cleanup. This is the regression target: previously this would
  // report `tripped: false` even though no real compaction
  // succeeded.
  expect(getBreakerTripState(SESSION_A).tripped).toBe(true)
  expect(getBreakerTripState(SESSION_A).lastFailureCount).toBe(3)
})

test('runPostCompactCleanup does not clear breaker state on a subagent (agent:*) source', () => {
  recordBreakerTripped(SESSION_A, {
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

  expect(getBreakerTripState(SESSION_A).tripped).toBe(true)
})

test('clearBreakerTrippedState is a no-op when no trip is recorded', () => {
  // Baseline: nothing tripped. The clear call must not throw or
  // mutate state in a way that would break subsequent reads.
  expect(getBreakerTripState(SESSION_A).tripped).toBe(false)
  clearBreakerTrippedState(SESSION_A)
  expect(getBreakerTripState(SESSION_A).tripped).toBe(false)
})

test('clearBreakerTrippedState resets a tripped state to recovered', () => {
  // Direct test of the call-site guard. Successful-compaction call
  // sites (auto session-memory, auto traditional, manual /compact
  // session-memory, manual /compact traditional) call this directly;
  // this is the canonical "recovery" signal the REPL/SDK reads.
  recordBreakerTripped(SESSION_A, {
    failureCount: 3,
    trippedAtMs: Date.now() - 60_000,
  })
  expect(getBreakerTripState(SESSION_A).tripped).toBe(true)

  clearBreakerTrippedState(SESSION_A)
  expect(getBreakerTripState(SESSION_A).tripped).toBe(false)
  expect(getBreakerTripState(SESSION_A).trippedAtMs).toBeUndefined()
  expect(getBreakerTripState(SESSION_A).lastFailureCount).toBeUndefined()
})

test('clearBreakerTrippedState preserves store identity (callers see fresh reads)', () => {
  // Sanity: clearing the store updates the in-place state object
  // returned by `getBreakerTripState`. Callers that have already
  // captured a reference to the state must see the cleared value
  // on a subsequent `getBreakerTripState()` call.
  recordBreakerTripped(SESSION_A, {
    failureCount: 3,
    trippedAtMs: Date.now(),
  })
  const before = getBreakerTripState(SESSION_A)
  expect(before.tripped).toBe(true)

  clearBreakerTrippedState(SESSION_A)
  const after = getBreakerTripState(SESSION_A)
  expect(after.tripped).toBe(false)
})

// ---------------------------------------------------------------------------
// Session isolation: one session's trip/clear must not leak to another.
// The REPL runs multiple main-thread sessions in a single process and
// keys autoCompactTracking by getSessionId(). Without session-scoped
// breaker state, one session tripping the breaker would make every
// session look "auto-compact paused", and a successful compaction in
// another session would silently clear the outage signal.
// ---------------------------------------------------------------------------

test('session isolation: a trip in session A does not affect session B', () => {
  recordBreakerTripped(SESSION_A, {
    failureCount: 3,
    trippedAtMs: Date.now() - 10_000,
  })

  expect(getBreakerTripState(SESSION_A).tripped).toBe(true)
  expect(getBreakerTripState(SESSION_B).tripped).toBe(false)
})

test('session isolation: clearing session A does not clear session B', () => {
  recordBreakerTripped(SESSION_A, {
    failureCount: 3,
    trippedAtMs: Date.now() - 10_000,
  })
  recordBreakerTripped(SESSION_B, {
    failureCount: 5,
    trippedAtMs: Date.now() - 5_000,
  })

  clearBreakerTrippedState(SESSION_A)

  expect(getBreakerTripState(SESSION_A).tripped).toBe(false)
  expect(getBreakerTripState(SESSION_B).tripped).toBe(true)
  expect(getBreakerTripState(SESSION_B).lastFailureCount).toBe(5)
})

test('session isolation: subscribe only fires for the subscribed session', () => {
  const callsA: string[] = []
  const callsB: string[] = []

  let unsubA: (() => void) | undefined
  let unsubB: (() => void) | undefined

  try {
    unsubA = (() => {
      // Import subscribe dynamically to avoid hoisting issues
      const { subscribeBreakerTripState } = require('./compactWarningState.js') as typeof import('./compactWarningState.js')
      return subscribeBreakerTripState(SESSION_A, () => { callsA.push('a') })
    })()
    unsubB = (() => {
      const { subscribeBreakerTripState } = require('./compactWarningState.js') as typeof import('./compactWarningState.js')
      return subscribeBreakerTripState(SESSION_B, () => { callsB.push('b') })
    })()

    // Trip only session A
    recordBreakerTripped(SESSION_A, {
      failureCount: 2,
      trippedAtMs: Date.now(),
    })

    expect(callsA).toEqual(['a'])
    expect(callsB).toEqual([])

    // Trip only session B
    recordBreakerTripped(SESSION_B, {
      failureCount: 4,
      trippedAtMs: Date.now(),
    })

    expect(callsA).toEqual(['a'])
    expect(callsB).toEqual(['b'])

    // Clear session A — only A's subscriber fires
    clearBreakerTrippedState(SESSION_A)

    expect(callsA).toEqual(['a', 'a'])
    expect(callsB).toEqual(['b'])
  } finally {
    unsubA?.()
    unsubB?.()
  }
})

test('clearBreakerTrippedState is a no-op for an unknown session', () => {
  // Must not throw or create spurious state.
  expect(() => clearBreakerTrippedState('nonexistent-session')).not.toThrow()
  expect(getBreakerTripState('nonexistent-session').tripped).toBe(false)
})

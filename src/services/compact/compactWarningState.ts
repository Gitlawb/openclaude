import { createStore } from '../../state/store.js'

/**
 * Tracks whether the "context left until autocompact" warning should be suppressed.
 * We suppress immediately after successful compaction since we don't have accurate
 * token counts until the next API response.
 */
export const compactWarningStore = createStore<boolean>(false)

/** Suppress the compact warning. Call after successful compaction. */
export function suppressCompactWarning(): void {
  compactWarningStore.setState(() => true)
}

/** Clear the compact warning suppression. Called at start of new compact attempt. */
export function clearCompactWarningSuppression(): void {
  compactWarningStore.setState(() => false)
}

/**
 * Tracks whether the auto-compact circuit breaker has tripped in the current
 * session. Surfaced for issue #1373 so the REPL/SDK can warn the user that
 * auto-compact is paused, instead of failing silently and letting the
 * conversation grow without bound.
 *
 * - `tripped` flips to true on the first failure that crosses the breaker
 *   threshold. Sticky: only cleared by an explicit reset (manual /compact
 *   success, session restart) or by `clearBreakerTrippedState` in tests.
 * - `trippedAtMs` records when the breaker last tripped — useful for the
 *   UI to show "X minutes ago".
 * - `lastFailureCount` is the number of consecutive failures at the moment
 *   of trip, in case the UI wants to display the streak.
 *
 * Kept in a separate store from `compactWarningStore` so existing callers of
 * `suppressCompactWarning` / `clearCompactWarningSuppression` are not affected
 * by the new fields and so test reset logic stays isolated.
 */
export type BreakerTripState = {
  tripped: boolean
  trippedAtMs?: number
  lastFailureCount?: number
}

const breakerTripStore = createStore<BreakerTripState>({ tripped: false })

/**
 * Mark the breaker as tripped in this session.
 *
 * Idempotent on the trip timestamp — repeat calls after the first only
 * refresh `lastFailureCount` so the UI can show the duration of the
 * original outage while tracking the latest failure count.
 *
 * @param args.failureCount The number of consecutive failures at the moment
 *   the breaker trips. Stored on the state so the UI can display the streak.
 * @param args.trippedAtMs Wall-clock time (from `Date.now()`) when the
 *   breaker tripped. Preserved across repeat calls.
 */
export function recordBreakerTripped(args: {
  failureCount: number
  trippedAtMs: number
}): void {
  breakerTripStore.setState(prev => {
    if (prev.tripped) {
      // Keep the original trip timestamp so the UI can show the duration of
      // the outage; only refresh the failure count.
      return { ...prev, lastFailureCount: args.failureCount }
    }
    return {
      tripped: true,
      trippedAtMs: args.trippedAtMs,
      lastFailureCount: args.failureCount,
    }
  })
}

/** Read the current breaker-trip state. */
export function getBreakerTripState(): BreakerTripState {
  return breakerTripStore.getState()
}

/** Clear the breaker-trip state. Called after successful compaction
 *  (auto session-memory, auto traditional, manual /compact) and from
 *  test teardown. Microcompact intentionally does not call this — it
 *  prunes tool-result content but doesn't actually compact the
 *  conversation, so the breaker should stay tripped. */
export function clearBreakerTrippedState(): void {
  breakerTripStore.setState(() => ({ tripped: false }))
}

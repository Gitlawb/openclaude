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
 * Tracks whether the auto-compact circuit breaker has tripped in a given
 * session. Surfaced for issue #1373 so the REPL/SDK can warn the user that
 * auto-compact is paused, instead of failing silently and letting the
 * conversation grow without bound.
 *
 * Session-scoped. The REPL runs multiple main-thread sessions in a single
 * process and keys `autoCompactTracking` by `getSessionId()`; background
 * sessions also call `query()` with the same `repl_main_thread` query
 * source. A single module-level store would let one session's trip leak
 * across every session (and one session's successful compaction clear
 * another's recovery signal), so the state is held in a `Map` keyed by
 * session ID. Every mutator/reader takes an explicit `sessionId` — no
 * hidden module-global resolution — which also makes the contract
 * straightforward to test.
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

/**
 * Internal sentinel. Each session gets its own `Store<BreakerTripState>`
 * so `subscribe()` is scoped per session (the future REPL/SDK reader can
 * listen to exactly one session without receiving notifications for the
 * others). The outer `Map` is never exposed.
 */
type BreakerTripStore = ReturnType<typeof createBreakerTripStore>

function createBreakerTripStore() {
  return createStore<BreakerTripState>({ tripped: false })
}

const breakerTripStores = new Map<string, BreakerTripStore>()

function getOrCreateStore(sessionId: string): BreakerTripStore {
  let store = breakerTripStores.get(sessionId)
  if (!store) {
    store = createBreakerTripStore()
    breakerTripStores.set(sessionId, store)
  }
  return store
}

/**
 * Mark the breaker as tripped for the given session.
 *
 * Idempotent on the trip timestamp — repeat calls after the first only
 * refresh `lastFailureCount` so the UI can show the duration of the
 * original outage while tracking the latest failure count.
 *
 * @param sessionId The session this trip belongs to. Callers pass
 *   `getSessionId()` so main-thread sessions in one process stay isolated.
 * @param args.failureCount The number of consecutive failures at the moment
 *   the breaker trips. Stored on the state so the UI can display the streak.
 * @param args.trippedAtMs Wall-clock time (from `Date.now()`) when the
 *   breaker tripped. Preserved across repeat calls.
 */
export function recordBreakerTripped(
  sessionId: string,
  args: { failureCount: number; trippedAtMs: number },
): void {
  const store = getOrCreateStore(sessionId)
  store.setState(prev => {
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

/** Read the current breaker-trip state for the given session. */
export function getBreakerTripState(sessionId: string): BreakerTripState {
  return getOrCreateStore(sessionId).getState()
}

/** Clear the breaker-trip state for the given session. Called after successful
 *  compaction (auto session-memory, auto traditional, manual /compact) and from
 *  test teardown. Microcompact intentionally does not call this — it
 *  prunes tool-result content but doesn't actually compact the
 *  conversation, so the breaker should stay tripped.
 *
 *  No-throw for unknown sessions (clearing a session that never tripped is
 *  a no-op), which keeps the successful-compaction call sites simple. */
export function clearBreakerTrippedState(sessionId: string): void {
  const store = breakerTripStores.get(sessionId)
  if (!store) {
    return
  }
  store.setState(() => ({ tripped: false }))
}

/**
 * Subscribe to breaker-trip state changes for a specific session. Returns an
 * unsubscribe function. Intended for the future REPL/SDK reader that surfaces
 * "auto-compact paused, retrying in N minutes" for the active session.
 *
 * Not currently wired into the UI (deferred to a follow-up per the #1373 PR),
 * but exposed now so the session-scoped read path has a matching subscribe.
 */
export function subscribeBreakerTripState(
  sessionId: string,
  listener: () => void,
): () => void {
  return getOrCreateStore(sessionId).subscribe(listener)
}

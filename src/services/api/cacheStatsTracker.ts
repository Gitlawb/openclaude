/**
 * Per-query and per-session cache metrics tracker for Phase 1 observability.
 *
 * Sits downstream of `extractCacheMetrics` (normalizer) and upstream of the
 * REPL display + `/cache-stats` command. The shim layers already report raw
 * usage into Anthropic-shaped fields, so this tracker listens for each
 * successful API response and folds the metrics into three buckets:
 *
 *   - currentTurn : cleared by callers at the start of each user turn
 *   - session     : accumulates from process start until `/clear`
 *   - history     : per-request log for `/cache-stats` breakdown view
 *
 * Design rationale:
 *   - Module-local state (not AppState, not bootstrap/state.ts) because
 *     this is strictly observability — nothing in the conversation flow
 *     depends on it and we don't want to couple the shim to React state.
 *   - `recordRequest()` takes an ALREADY-normalized CacheMetrics so the
 *     shim layer can resolve provider once and we avoid re-running env
 *     detection on every response.
 *   - `history` is bounded (DEFAULT_HISTORY_MAX) so a long-lived session
 *     can't grow memory unboundedly. Oldest entries drop first.
 *   - `supported: false` requests still land in history (so the user can
 *     see "6 requests, all N/A" rather than "no data"), but they add to
 *     sums as zero — `addCacheMetrics` preserves the supported flag.
 *
 * History is stored as a **ring buffer** (fixed-size array + write index).
 * Previous implementation used `array.splice(0, n)` on every overflow,
 * which shifts the entire tail — O(n) per recordRequest for the default
 * cap of 500 (negligible in practice, but wasteful). The ring makes
 * `recordRequest` strictly O(1). `getCacheStatsHistory()` still pays O(n)
 * to reconstruct chronological order, but that only runs when the user
 * opens `/cache-stats` or the REPL renders — never in the hot path.
 */
import { addCacheMetrics, type CacheMetrics } from './cacheMetrics.js'

/** One request's cache footprint — what the tracker remembers per turn. */
export type CacheStatsEntry = {
  /** Unix ms when the request completed. */
  timestamp: number
  /** Opaque label (usually the model string) for `/cache-stats` rows. */
  label: string
  /** Normalized metrics for this single request. */
  metrics: CacheMetrics
}

// Bound the per-session history. 500 requests ≈ a full day of active use;
// any more than that is noise for a diagnostic command and starts costing
// real memory (~100 bytes per entry with the labels).
const DEFAULT_HISTORY_MAX = 500

const EMPTY_METRICS: CacheMetrics = {
  read: 0,
  created: 0,
  total: 0,
  hitRate: null,
  supported: false,
}

type TrackerState = {
  currentTurn: CacheMetrics
  session: CacheMetrics
  // Ring buffer: fixed-size array, `historyWriteIdx` points at the next
  // slot to overwrite. Once `historySize === historyMax`, each new push
  // drops the oldest entry by simply overwriting it — no shifting.
  history: (CacheStatsEntry | undefined)[]
  historyWriteIdx: number
  historySize: number
  historyMax: number
}

function createInitialState(max: number): TrackerState {
  return {
    currentTurn: EMPTY_METRICS,
    session: EMPTY_METRICS,
    history: new Array(max),
    historyWriteIdx: 0,
    historySize: 0,
    historyMax: max,
  }
}

const state: TrackerState = createInitialState(DEFAULT_HISTORY_MAX)

/**
 * Record a single API response's normalized cache metrics. Idempotent per
 * request (caller ensures this isn't double-counted) — safe to call from
 * the shim right after `addToTotalSessionCost`.
 *
 * O(1) via ring-buffer write — previously used `splice(0, n)` on overflow
 * which was O(n) per call for the default cap of 500.
 */
export function recordRequest(
  metrics: CacheMetrics,
  label: string,
): void {
  state.currentTurn = addCacheMetrics(state.currentTurn, metrics)
  state.session = addCacheMetrics(state.session, metrics)
  const entry: CacheStatsEntry = {
    timestamp: Date.now(),
    label,
    metrics,
  }
  // Overwrite at the write head. If the ring is full, this drops the
  // oldest entry (which previously lived at this slot) implicitly.
  state.history[state.historyWriteIdx] = entry
  state.historyWriteIdx = (state.historyWriteIdx + 1) % state.historyMax
  if (state.historySize < state.historyMax) {
    state.historySize++
  }
}

/** Clear turn-level counters at the start of a new user turn. */
export function resetCurrentTurn(): void {
  state.currentTurn = EMPTY_METRICS
}

/** Clear all session state — used by `/clear`, `/compact`, tests. */
export function resetSessionCacheStats(): void {
  state.currentTurn = EMPTY_METRICS
  state.session = EMPTY_METRICS
  // Rebuild the ring so any hold-over references can be GC'd. Slightly
  // more work than zeroing indices, but `/clear` is rare and this avoids
  // silently pinning old CacheStatsEntry objects in memory.
  state.history = new Array(state.historyMax)
  state.historyWriteIdx = 0
  state.historySize = 0
}

/** Snapshot of the current turn's aggregate. */
export function getCurrentTurnCacheMetrics(): CacheMetrics {
  return state.currentTurn
}

/** Snapshot of the session-wide aggregate. */
export function getSessionCacheMetrics(): CacheMetrics {
  return state.session
}

/**
 * Recent per-request entries, oldest-first. Returns a copy so callers
 * can freely sort/filter without perturbing the tracker.
 *
 * Walks the ring from the oldest slot to the newest. Two cases:
 *   - not yet full: oldest is at index 0, newest at `size-1`
 *   - full / wrapped: oldest is at `writeIdx`, newest at `writeIdx-1`
 */
export function getCacheStatsHistory(): CacheStatsEntry[] {
  if (state.historySize < state.historyMax) {
    // Fast path: ring hasn't wrapped yet, entries live at [0..size).
    return state.history.slice(0, state.historySize) as CacheStatsEntry[]
  }
  // Wrapped: reconstruct oldest-first by concatenating the two halves.
  const tail = state.history.slice(state.historyWriteIdx) as CacheStatsEntry[]
  const head = state.history.slice(0, state.historyWriteIdx) as CacheStatsEntry[]
  return tail.concat(head)
}

/**
 * Test/debug hook — do not use in production paths. Resizes the ring
 * preserving the most recent `min(cap, size)` entries in chronological
 * order, so tests can shrink the cap and verify eviction behavior.
 */
export function _setHistoryCapForTesting(cap: number): void {
  // Cap must be positive — a zero-sized ring would divide by zero on
  // `preserved.length % cap`. Throw loudly rather than silently land on
  // `NaN` indices that would corrupt the ring on the next push.
  if (cap < 1) {
    throw new Error(`_setHistoryCapForTesting: cap must be >= 1 (got ${cap})`)
  }
  const current = getCacheStatsHistory()
  const preserved = cap < current.length ? current.slice(-cap) : current
  state.history = new Array(cap)
  for (let i = 0; i < preserved.length; i++) {
    state.history[i] = preserved[i]
  }
  state.historyWriteIdx = preserved.length % cap
  state.historySize = preserved.length
  state.historyMax = cap
}

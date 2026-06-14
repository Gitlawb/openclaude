/**
 * Synchronous state machine for the query lifecycle, compatible with
 * React's `useSyncExternalStore`.
 *
 * Three states:
 *   idle        → no query, safe to dequeue and process
 *   dispatching → an item was dequeued, async chain hasn't reached onQuery yet
 *   running     → onQuery called tryStart(), query is executing
 *
 * Transitions:
 *   idle → dispatching  (reserve)
 *   dispatching → running  (tryStart)
 *   idle → running  (tryStart, for direct user submissions)
 *   running → idle  (end / forceEnd / timeout)
 *   dispatching → idle  (cancelReservation, when processQueueIfReady fails)
 *
 * `isActive` returns true for both dispatching and running, preventing
 * re-entry from the queue processor during the async gap.
 *
 * Timeout:
 *   If a query runs longer than QUERY_TIMEOUT_MS, the guard automatically
 *   force-ends to prevent infinite spinner loops (see issue #1207).
 *
 * Usage with React:
 *   const queryGuard = useRef(new QueryGuard()).current
 *   const isQueryActive = useSyncExternalStore(
 *     queryGuard.subscribe,
 *     queryGuard.getSnapshot,
 *   )
 */
import { createSignal } from './signal.js'

const QUERY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
type QueryTimeoutHandler = (generation: number) => void

export class QueryGuard {
  private _status: 'idle' | 'dispatching' | 'running' = 'idle'
  private _generation = 0
  private _changed = createSignal()
  private _timeoutId: ReturnType<typeof setTimeout> | null = null
  private _timeoutHandler: QueryTimeoutHandler | null = null

  /**
   * Reserve the guard for queue processing. Transitions idle → dispatching.
   * Returns false if not idle (another query or dispatch in progress).
   */
  reserve(): boolean {
    if (this._status !== 'idle') return false
    this._status = 'dispatching'
    this._notify()
    return true
  }

  /**
   * Cancel a reservation when processQueueIfReady had nothing to process.
   * Transitions dispatching → idle.
   */
  cancelReservation(): void {
    if (this._status !== 'dispatching') return
    this._status = 'idle'
    this._notify()
  }

  /**
   * Start a query. Returns the generation number on success,
   * or null if a query is already running (concurrent guard).
   * Accepts transitions from both idle (direct user submit)
   * and dispatching (queue processor path).
   */
  tryStart(): number | null {
    if (this._status === 'running') return null
    this._status = 'running'
    ++this._generation
    this._startTimeout()
    this._notify()
    return this._generation
  }

  /**
   * End a query. Returns true if this generation is still current
   * (meaning the caller should perform cleanup). Returns false if a
   * newer query has started (stale finally block from a cancelled query).
   */
  end(generation: number): boolean {
    if (this._generation !== generation) return false
    if (this._status !== 'running') return false
    this._clearTimeout()
    this._status = 'idle'
    this._notify()
    return true
  }

  /**
   * Force-end the current query regardless of generation.
   * Used by onCancel where any running query should be terminated.
   * Increments generation so stale finally blocks from the cancelled
   * query's promise rejection will see a mismatch and skip cleanup.
   */
  forceEnd(): void {
    if (this._status === 'idle') return
    this._clearTimeout()
    this._status = 'idle'
    ++this._generation
    this._notify()
  }

  /**
   * Is the guard active (dispatching or running)?
   * Always synchronous — not subject to React state batching delays.
   */
  get isActive(): boolean {
    return this._status !== 'idle'
  }

  get generation(): number {
    return this._generation
  }

  /**
   * Register a single owner callback for watchdog timeouts. The callback runs
   * before forceEnd(), so callers can abort in-flight work while the timed-out
   * generation is still current.
   */
  setTimeoutHandler(handler: QueryTimeoutHandler | null): () => void {
    this._timeoutHandler = handler
    return () => {
      if (this._timeoutHandler === handler) {
        this._timeoutHandler = null
      }
    }
  }

  // --
  // useSyncExternalStore interface

  /** Subscribe to state changes. Stable reference — safe as useEffect dep. */
  subscribe = this._changed.subscribe

  /** Snapshot for useSyncExternalStore. Returns `isActive`. */
  getSnapshot = (): boolean => {
    return this._status !== 'idle'
  }

  private _notify(): void {
    this._changed.emit()
  }

  /**
   * Start a watchdog timer. If the query doesn't complete within
   * QUERY_TIMEOUT_MS, automatically force-end to prevent infinite loops.
   */
  private _startTimeout(): void {
    this._clearTimeout()
    this._timeoutId = setTimeout(() => {
      if (this._status === 'running') {
        console.error(`[QueryGuard] Query timeout after ${QUERY_TIMEOUT_MS}ms — force-ending to prevent infinite spinner`)
        try {
          this._timeoutHandler?.(this._generation)
        } catch (error) {
          console.error('[QueryGuard] Timeout handler failed', error)
        } finally {
          this.forceEnd()
        }
      }
    }, QUERY_TIMEOUT_MS)
  }

  private _clearTimeout(): void {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId)
      this._timeoutId = null
    }
  }
}

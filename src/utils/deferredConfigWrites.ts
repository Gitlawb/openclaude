// Coalesced (debounced) write engine, factored out of config.ts so the queue,
// debounce timer, write-through, and batch-drain logic can be unit-tested with
// injected storage/scheduler instead of through the NODE_ENV=test bypass (which
// delegates straight to the synchronous writer and never exercises this path).
//
// The engine is intentionally generic over the config type and free of any
// global/process/disk access — config.ts wires the real saveGlobalConfig,
// in-memory cache, and setTimeout/clearTimeout into it.

export type Updater<C> = (current: C) => C

export interface DeferredWriterDeps<C, H> {
  /** Trailing-debounce window before a queued batch is flushed. */
  debounceMs: number
  /** Persist one composed updater for the whole batch (the locked disk write). */
  save: (updater: Updater<C>) => void
  /** Current in-process cache value, or null when nothing is cached yet. */
  readCache: () => C | null
  /** Apply an immediate in-memory write-through so same-process reads stay coherent. */
  writeThrough: (next: C) => void
  /** Schedule the trailing flush. Returns a handle passed back to clearTimer. */
  setTimer: (fn: () => void, ms: number) => H
  /** Cancel a scheduled flush. */
  clearTimer: (handle: H) => void
}

export interface DeferredWriter<C> {
  /** Queue an updater; write-through immediately, flush to disk on the debounce. */
  defer: (updater: Updater<C>) => void
  /** Force any queued writes now. Safe to call repeatedly; no-op when idle. */
  flush: () => void
  /** Number of updaters currently queued (diagnostics/tests). */
  pendingCount: () => number
}

export function createDeferredWriter<C, H>(
  deps: DeferredWriterDeps<C, H>,
): DeferredWriter<C> {
  let pending: Array<Updater<C>> = []
  let timer: H | null = null

  function flush(): void {
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    if (pending.length === 0) {
      return
    }
    const updaters = pending
    pending = []
    // One locked read-modify-write for the whole batch. Compose in call order
    // so the result matches applying each save in sequence.
    //
    // The queue is drained before save() intentionally: this writer is for
    // loss-tolerant counters/flags only, the in-memory cache was already
    // write-through-updated in defer(), and save() (saveGlobalConfig) catches
    // its own lock/permission errors. Re-queuing on a throw would risk
    // double-applying updaters that already landed in the cache.
    deps.save(config => updaters.reduce((acc, fn) => fn(acc), config))
  }

  function defer(updater: Updater<C>): void {
    // Apply to the in-memory cache now so reads in this process see the pending
    // change before it is flushed. The authoritative apply still happens against
    // the persisted config inside the flushed save().
    const cached = deps.readCache()
    if (cached !== null) {
      const next = updater(cached)
      if (next !== cached) {
        deps.writeThrough(next)
      }
    }

    pending.push(updater)
    if (timer === null) {
      timer = deps.setTimer(flush, deps.debounceMs)
    }
  }

  return { defer, flush, pendingCount: () => pending.length }
}

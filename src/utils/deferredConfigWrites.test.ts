import { describe, expect, test } from 'bun:test'

import { createDeferredWriter } from './deferredConfigWrites.js'

type Cfg = { n: number }

// A fake scheduler + storage so the real queue/debounce/write-through/drain
// logic runs without NODE_ENV bypass, timers, or disk. Each handle is an id we
// can fire on demand to simulate the debounce elapsing.
//
// The persisted store and the in-memory cache are kept SEPARATE, matching
// production: save() (saveGlobalConfig) applies to the authoritative store,
// while readCache()/writeThrough() touch the same-process cache. They start
// equal and the composed batch must bring the store back in line.
function makeHarness(
  initialCache: Cfg | null = { n: 0 },
  initialPersisted: Cfg = initialCache ?? { n: 0 },
) {
  let cache: Cfg | null = initialCache
  let persisted: Cfg = initialPersisted
  const saves: Array<Cfg> = []
  const writeThroughs: Array<Cfg> = []
  let nextId = 1
  const timers = new Map<number, () => void>()

  const writer = createDeferredWriter<Cfg, number>({
    debounceMs: 500,
    save: updater => {
      persisted = updater(persisted)
      saves.push(persisted)
    },
    readCache: () => cache,
    writeThrough: next => {
      cache = next
      writeThroughs.push(next)
    },
    setTimer: fn => {
      const id = nextId++
      timers.set(id, fn)
      return id
    },
    clearTimer: id => {
      timers.delete(id)
    },
  })

  return {
    writer,
    saves,
    writeThroughs,
    getCache: () => cache,
    scheduledCount: () => timers.size,
    fireTimers: () => {
      // Fire every scheduled timer (the engine only ever schedules one).
      for (const fn of [...timers.values()]) fn()
    },
    // Models config.ts saveGlobalConfig: it re-reads the persisted store, applies
    // its own updater, and write-throughs the result to the cache. When
    // flushFirst is true it drains the deferred queue first (the fix), so a
    // pending delta is not clobbered.
    directSave: (updater: (c: Cfg) => Cfg, flushFirst: boolean) => {
      if (flushFirst) writer.flush()
      persisted = updater(persisted)
      cache = persisted
    },
  }
}

describe('createDeferredWriter (the non-bypassed deferred path)', () => {
  test('write-throughs immediately but defers the persisted save to the debounce', () => {
    const h = makeHarness({ n: 0 })

    h.writer.defer(c => ({ n: c.n + 1 }))

    // Visible to same-process reads at once...
    expect(h.getCache()).toEqual({ n: 1 })
    expect(h.writeThroughs).toHaveLength(1)
    // ...but not yet persisted, and exactly one flush is scheduled.
    expect(h.saves).toHaveLength(0)
    expect(h.writer.pendingCount()).toBe(1)
    expect(h.scheduledCount()).toBe(1)
  })

  test('coalesces several writes into a single composed save in call order', () => {
    const h = makeHarness({ n: 0 })

    h.writer.defer(c => ({ n: c.n + 1 })) // +1
    h.writer.defer(c => ({ n: c.n * 2 })) // *2
    h.writer.defer(c => ({ n: c.n + 3 })) // +3

    // Still one debounce window, nothing persisted yet.
    expect(h.scheduledCount()).toBe(1)
    expect(h.saves).toHaveLength(0)
    expect(h.writer.pendingCount()).toBe(3)

    h.fireTimers()

    // ((0+1)*2)+3 = 5 — a single batched save applied in order.
    expect(h.saves).toEqual([{ n: 5 }])
    expect(h.writer.pendingCount()).toBe(0)
    expect(h.scheduledCount()).toBe(0)
  })

  test('the trailing timer drains the batch', () => {
    const h = makeHarness({ n: 10 })
    h.writer.defer(c => ({ n: c.n + 5 }))

    expect(h.saves).toHaveLength(0)
    h.fireTimers()
    expect(h.saves).toEqual([{ n: 15 }])
  })

  test('flush() drains synchronously and cancels the scheduled timer', () => {
    const h = makeHarness({ n: 0 })
    h.writer.defer(c => ({ n: c.n + 7 }))
    expect(h.scheduledCount()).toBe(1)

    h.writer.flush()

    expect(h.saves).toEqual([{ n: 7 }])
    expect(h.scheduledCount()).toBe(0)
    // A second flush is a no-op (nothing queued).
    h.writer.flush()
    expect(h.saves).toHaveLength(1)
  })

  test('flush() is a safe no-op when nothing is queued', () => {
    const h = makeHarness({ n: 0 })
    expect(() => h.writer.flush()).not.toThrow()
    expect(h.saves).toHaveLength(0)
  })

  test('a no-op updater (same reference) skips the write-through', () => {
    const h = makeHarness({ n: 3 })

    h.writer.defer(c => c) // returns same ref

    expect(h.writeThroughs).toHaveLength(0)
    expect(h.getCache()).toEqual({ n: 3 })
    // It is still queued, so the persisted apply runs on flush.
    h.writer.flush()
    expect(h.saves).toEqual([{ n: 3 }])
  })

  test('defers persistence even when the cache is empty (no write-through possible)', () => {
    const h = makeHarness(null)

    h.writer.defer(() => ({ n: 99 }))

    expect(h.writeThroughs).toHaveLength(0) // nothing to write through yet
    expect(h.writer.pendingCount()).toBe(1)
    h.writer.flush()
    expect(h.saves).toEqual([{ n: 99 }])
  })

  // Regression for the CodeRabbit cold-cache finding. On a null cache the
  // engine cannot write through, so the first deferred update is invisible to
  // same-process reads until the flush — which is why saveGlobalConfigDeferred
  // primes the cache (via getGlobalConfig) before enqueueing.
  test('first deferred write is invisible on a cold cache but visible once primed', () => {
    // Cold cache: defer skips the write-through, so a same-process read sees
    // nothing until the debounce.
    const cold = makeHarness(null)
    cold.writer.defer(c => ({ n: (c?.n ?? 0) + 1 }))
    expect(cold.writeThroughs).toHaveLength(0)
    expect(cold.getCache()).toBeNull()

    // Primed cache (what the wrapper now guarantees): the first deferred update
    // write-throughs immediately and is visible before any flush.
    const primed = makeHarness({ n: 0 })
    primed.writer.defer(c => ({ n: c.n + 1 }))
    expect(primed.writeThroughs).toHaveLength(1)
    expect(primed.getCache()).toEqual({ n: 1 })
  })

  test('schedules a fresh timer for the next batch after a flush', () => {
    const h = makeHarness({ n: 0 })
    h.writer.defer(c => ({ n: c.n + 1 }))
    h.fireTimers()
    expect(h.saves).toEqual([{ n: 1 }])

    // A new write after draining must schedule again, not silently drop.
    h.writer.defer(c => ({ n: c.n + 1 }))
    expect(h.scheduledCount()).toBe(1)
    h.fireTimers()
    expect(h.saves).toEqual([{ n: 1 }, { n: 2 }])
  })

  // Regression for the CodeRabbit finding: a direct save landing before the
  // debounce fires must not strand the pending deferred delta out of the cache.
  test('a direct save flushes pending deferred writes first to stay coherent', () => {
    // Without the flush, the direct save reads the persisted store (which has
    // not seen the deferred delta yet) and overwrites the cache, dropping it.
    const buggy = makeHarness({ n: 0 })
    buggy.writer.defer(c => ({ n: c.n + 1 })) // cache -> 1, pending = [+1]
    buggy.directSave(c => ({ n: c.n + 100 }), /* flushFirst */ false)
    expect(buggy.getCache()).toEqual({ n: 100 }) // stale: the +1 was clobbered

    // With the fix (flush first), the deferred delta is applied before the
    // direct save, so the cache stays coherent: +1 then +100.
    const fixed = makeHarness({ n: 0 })
    fixed.writer.defer(c => ({ n: c.n + 1 }))
    fixed.directSave(c => ({ n: c.n + 100 }), /* flushFirst */ true)
    expect(fixed.getCache()).toEqual({ n: 101 })
    expect(fixed.writer.pendingCount()).toBe(0)
  })
})

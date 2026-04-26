import { beforeEach, expect, test, describe } from 'bun:test'
import {
  _setHistoryCapForTesting,
  getCacheStatsHistory,
  getCurrentTurnCacheMetrics,
  getSessionCacheMetrics,
  recordRequest,
  resetCurrentTurn,
  resetSessionCacheStats,
} from './cacheStatsTracker.js'
import type { CacheMetrics } from './cacheMetrics.js'

function makeMetrics(partial: Partial<CacheMetrics>): CacheMetrics {
  return {
    read: 0,
    created: 0,
    total: 0,
    hitRate: null,
    supported: true,
    ...partial,
  }
}

beforeEach(() => {
  resetSessionCacheStats()
  _setHistoryCapForTesting(500)
})

describe('cacheStatsTracker — aggregation', () => {
  test('currentTurn and session both start empty and unsupported', () => {
    expect(getCurrentTurnCacheMetrics().supported).toBe(false)
    expect(getSessionCacheMetrics().supported).toBe(false)
    expect(getCacheStatsHistory()).toEqual([])
  })

  test('one recorded request flows into both turn and session', () => {
    recordRequest(
      makeMetrics({ read: 500, total: 1000, hitRate: 0.5 }),
      'claude-sonnet-4',
    )
    expect(getCurrentTurnCacheMetrics().read).toBe(500)
    expect(getCurrentTurnCacheMetrics().total).toBe(1000)
    expect(getSessionCacheMetrics().read).toBe(500)
  })

  test('multiple requests sum across turn', () => {
    recordRequest(
      makeMetrics({ read: 100, total: 500, hitRate: 0.2 }),
      'm1',
    )
    recordRequest(
      makeMetrics({ read: 300, total: 500, hitRate: 0.6 }),
      'm1',
    )
    const turn = getCurrentTurnCacheMetrics()
    expect(turn.read).toBe(400)
    expect(turn.total).toBe(1000)
    expect(turn.hitRate).toBeCloseTo(0.4, 5)
  })

  test('resetCurrentTurn clears turn but preserves session', () => {
    recordRequest(makeMetrics({ read: 200, total: 400 }), 'm1')
    resetCurrentTurn()
    expect(getCurrentTurnCacheMetrics().supported).toBe(false)
    expect(getSessionCacheMetrics().read).toBe(200)
  })

  test('resetSessionCacheStats clears everything', () => {
    recordRequest(makeMetrics({ read: 200, total: 400 }), 'm1')
    resetSessionCacheStats()
    expect(getCurrentTurnCacheMetrics().supported).toBe(false)
    expect(getSessionCacheMetrics().supported).toBe(false)
    expect(getCacheStatsHistory()).toEqual([])
  })
})

describe('cacheStatsTracker — history', () => {
  test('records each request with label and timestamp', () => {
    const before = Date.now()
    recordRequest(makeMetrics({ read: 1, total: 2 }), 'model-A')
    recordRequest(makeMetrics({ read: 3, total: 4 }), 'model-B')
    const history = getCacheStatsHistory()
    expect(history.length).toBe(2)
    expect(history[0]!.label).toBe('model-A')
    expect(history[1]!.label).toBe('model-B')
    expect(history[0]!.timestamp).toBeGreaterThanOrEqual(before)
  })

  test('evicts oldest entries when cap is exceeded', () => {
    _setHistoryCapForTesting(3)
    for (let i = 0; i < 5; i++) {
      recordRequest(makeMetrics({ read: i, total: 10 }), `m${i}`)
    }
    const history = getCacheStatsHistory()
    expect(history.length).toBe(3)
    expect(history.map((h) => h.label)).toEqual(['m2', 'm3', 'm4'])
  })

  test('history copy is detached from internal state', () => {
    recordRequest(makeMetrics({ read: 1, total: 2 }), 'x')
    const snapshot = getCacheStatsHistory()
    snapshot.pop()
    expect(getCacheStatsHistory().length).toBe(1)
  })
})

describe('cacheStatsTracker — ring buffer semantics', () => {
  test('ring wraps at cap without shifting (chronological order preserved)', () => {
    _setHistoryCapForTesting(4)
    // Push exactly 2×cap entries — forces one full wrap.
    for (let i = 0; i < 8; i++) {
      recordRequest(makeMetrics({ read: i, total: 10 }), `m${i}`)
    }
    const history = getCacheStatsHistory()
    expect(history.length).toBe(4)
    // After 8 pushes with cap=4, the survivors must be the newest 4 —
    // m4, m5, m6, m7 — in chronological order. If the ring logic were
    // wrong (e.g. off-by-one on writeIdx) this would come out rotated.
    expect(history.map((h) => h.label)).toEqual(['m4', 'm5', 'm6', 'm7'])
  })

  test('read before ring wraps returns partial history in order', () => {
    _setHistoryCapForTesting(10)
    for (let i = 0; i < 3; i++) {
      recordRequest(makeMetrics({ read: i, total: 10 }), `m${i}`)
    }
    const history = getCacheStatsHistory()
    expect(history.map((h) => h.label)).toEqual(['m0', 'm1', 'm2'])
  })

  test('shrinking cap preserves the newest entries in order', () => {
    _setHistoryCapForTesting(5)
    for (let i = 0; i < 5; i++) {
      recordRequest(makeMetrics({ read: i, total: 10 }), `m${i}`)
    }
    _setHistoryCapForTesting(3)
    const history = getCacheStatsHistory()
    expect(history.map((h) => h.label)).toEqual(['m2', 'm3', 'm4'])
    // And pushing after shrink still respects the new cap.
    recordRequest(makeMetrics({ read: 5, total: 10 }), 'm5')
    expect(getCacheStatsHistory().map((h) => h.label)).toEqual(['m3', 'm4', 'm5'])
  })

  test('growing cap preserves existing entries and accepts more', () => {
    _setHistoryCapForTesting(3)
    for (let i = 0; i < 3; i++) {
      recordRequest(makeMetrics({ read: i, total: 10 }), `m${i}`)
    }
    _setHistoryCapForTesting(6)
    // After growing, the existing three should still be there in order,
    // and we should be able to push three more before eviction starts.
    for (let i = 3; i < 6; i++) {
      recordRequest(makeMetrics({ read: i, total: 10 }), `m${i}`)
    }
    const history = getCacheStatsHistory()
    expect(history.map((h) => h.label)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
    ])
  })

  test('_setHistoryCapForTesting throws on non-positive cap', () => {
    // A zero cap would divide-by-zero on the ring write index and
    // silently corrupt the buffer. Loud failure > NaN indices.
    expect(() => _setHistoryCapForTesting(0)).toThrow(/cap must be >= 1/)
    expect(() => _setHistoryCapForTesting(-3)).toThrow(/cap must be >= 1/)
  })

  test('resetSessionCacheStats empties the ring even when wrapped', () => {
    _setHistoryCapForTesting(3)
    for (let i = 0; i < 10; i++) {
      recordRequest(makeMetrics({ read: i, total: 10 }), `m${i}`)
    }
    // Sanity: ring has wrapped many times.
    expect(getCacheStatsHistory().length).toBe(3)
    resetSessionCacheStats()
    expect(getCacheStatsHistory()).toEqual([])
    // And a fresh push after reset starts from index 0 again.
    recordRequest(makeMetrics({ read: 99, total: 100 }), 'post-reset')
    const after = getCacheStatsHistory()
    expect(after.length).toBe(1)
    expect(after[0]!.label).toBe('post-reset')
  })
})

describe('cacheStatsTracker — unsupported mixing', () => {
  test('mixing supported + unsupported keeps supported data visible', () => {
    recordRequest(
      {
        read: 0,
        created: 0,
        total: 0,
        hitRate: null,
        supported: false,
      },
      'copilot',
    )
    recordRequest(
      makeMetrics({ read: 100, total: 500, hitRate: 0.2 }),
      'claude',
    )
    const turn = getCurrentTurnCacheMetrics()
    expect(turn.supported).toBe(true)
    expect(turn.read).toBe(100)
  })
})

import { afterEach, describe, test, expect, vi } from 'vitest'
import { QueryGuard } from './QueryGuard.js'

describe('QueryGuard', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('starts idle', () => {
    const guard = new QueryGuard()
    expect(guard.isActive).toBe(false)
    expect(guard.generation).toBe(0)
  })

  test('tryStart transitions to running', () => {
    const guard = new QueryGuard()
    const gen = guard.tryStart()
    expect(gen).toBe(1)
    expect(guard.isActive).toBe(true)
  })

  test('end returns to idle', () => {
    const guard = new QueryGuard()
    const gen = guard.tryStart()!
    expect(guard.end(gen)).toBe(true)
    expect(guard.isActive).toBe(false)
  })

  test('end rejects stale generation', () => {
    const guard = new QueryGuard()
    const gen1 = guard.tryStart()!
    guard.forceEnd()
    const gen2 = guard.tryStart()!
    expect(guard.end(gen1)).toBe(false)
    expect(guard.isActive).toBe(true)
    expect(guard.end(gen2)).toBe(true)
  })

  test('forceEnd always works', () => {
    const guard = new QueryGuard()
    guard.tryStart()
    guard.forceEnd()
    expect(guard.isActive).toBe(false)
  })

  test('idle timeout auto force-ends after 5 minutes without activity', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard()
    guard.tryStart()
    expect(guard.isActive).toBe(true)

    // Just before timeout
    vi.advanceTimersByTime(5 * 60 * 1000 - 1)
    expect(guard.isActive).toBe(true)

    // At timeout
    vi.advanceTimersByTime(1)
    expect(guard.isActive).toBe(false)
  })

  test('timeout notifies owner with the timed-out generation and reason', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard()
    const onTimeout = vi.fn()
    guard.setTimeoutHandler(onTimeout)

    const gen = guard.tryStart()!
    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout).toHaveBeenCalledWith(gen, 'idle')
    expect(guard.isActive).toBe(false)
  })

  test('timeout handler cleanup prevents stale notification', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard()
    const onTimeout = vi.fn()
    const cleanup = guard.setTimeoutHandler(onTimeout)
    cleanup()

    guard.tryStart()
    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(onTimeout).not.toHaveBeenCalled()
    expect(guard.isActive).toBe(false)
  })

  test('timeout handler errors do not escape the watchdog callback', () => {
    vi.useFakeTimers()
    const guard = new QueryGuard()
    const handlerError = new Error('handler failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    guard.setTimeoutHandler(() => {
      throw handlerError
    })

    guard.tryStart()

    expect(() => vi.advanceTimersByTime(5 * 60 * 1000)).not.toThrow()
    expect(guard.isActive).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('[QueryGuard] Timeout handler failed', handlerError)
  })

  test('API stream activity extends the idle deadline only while progress continues', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard({
      idleTimeoutMs: 100,
      hardMaxQueryMs: 1_000,
    })
    const gen = guard.tryStart()!

    vi.advanceTimersByTime(90)
    guard.registerActivity('api_stream', gen)
    vi.advanceTimersByTime(99)
    expect(guard.isActive).toBe(true)

    vi.advanceTimersByTime(1)
    expect(guard.isActive).toBe(false)
  })

  test('query aborts when idle timeout is reached with no activity', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard({
      idleTimeoutMs: 100,
      hardMaxQueryMs: 1_000,
    })
    guard.tryStart()

    vi.advanceTimersByTime(100)

    expect(guard.isActive).toBe(false)
  })

  test('active bounded lease is not aborted merely because idle timeout elapses', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard({
      idleTimeoutMs: 500,
      hardMaxQueryMs: 1_000,
      toolLeaseGraceMs: 10,
    })
    const gen = guard.tryStart()!
    const lease = guard.acquireLease({
      owner: 'bash',
      id: 'toolu_1',
      timeoutMs: 500,
    }, gen)

    vi.advanceTimersByTime(500)

    expect(guard.isActive).toBe(true)
    lease.release()
    expect(guard.end(gen)).toBe(true)
  })

  test('lease deadline aborts bounded work that exceeds its own timeout', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard({
      idleTimeoutMs: 500,
      hardMaxQueryMs: 1_000,
      toolLeaseGraceMs: 10,
    })
    const onTimeout = vi.fn()
    guard.setTimeoutHandler(onTimeout)
    const gen = guard.tryStart()!
    guard.acquireLease({
      owner: 'bash',
      id: 'toolu_1',
      timeoutMs: 500,
    }, gen)

    vi.advanceTimersByTime(509)
    expect(guard.isActive).toBe(true)
    vi.advanceTimersByTime(1)

    expect(guard.isActive).toBe(false)
    expect(onTimeout).toHaveBeenCalledWith(gen, 'lease_expired')
  })

  test('hard maximum aborts even with active leases and activity', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard({
      idleTimeoutMs: 100,
      hardMaxQueryMs: 1_000,
      toolLeaseGraceMs: 10,
    })
    const onTimeout = vi.fn()
    guard.setTimeoutHandler(onTimeout)
    const gen = guard.tryStart()!
    guard.acquireLease({
      owner: 'bash',
      id: 'toolu_1',
      timeoutMs: 5_000,
    }, gen)

    for (let elapsed = 0; elapsed < 900; elapsed += 90) {
      vi.advanceTimersByTime(90)
      guard.registerActivity('api_stream', gen)
      expect(guard.isActive).toBe(true)
    }

    vi.advanceTimersByTime(100)

    expect(guard.isActive).toBe(false)
    expect(onTimeout).toHaveBeenCalledWith(gen, 'hard_max')
  })

  test('lease hard cap is relative to acquisition and capped by query remaining budget', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard({
      idleTimeoutMs: 500,
      hardMaxQueryMs: 1_000,
      toolLeaseGraceMs: 10,
    })
    const onTimeout = vi.fn()
    guard.setTimeoutHandler(onTimeout)
    const gen = guard.tryStart()!

    vi.advanceTimersByTime(400)
    guard.acquireLease({
      owner: 'tool',
      id: 'toolu_late',
      timeoutMs: 500,
      hardCapMs: 300,
    }, gen)

    vi.advanceTimersByTime(299)
    expect(guard.isActive).toBe(true)
    vi.advanceTimersByTime(1)

    expect(guard.isActive).toBe(false)
    expect(onTimeout).toHaveBeenCalledWith(gen, 'lease_expired')
  })

  test('stale generations cannot extend or release a newer query', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = new QueryGuard({
      idleTimeoutMs: 100,
      hardMaxQueryMs: 1_000,
      toolLeaseGraceMs: 10,
    })
    const onTimeout = vi.fn()
    guard.setTimeoutHandler(onTimeout)

    const gen1 = guard.tryStart()!
    const staleLease = guard.acquireLease({
      owner: 'bash',
      id: 'toolu_stale',
      timeoutMs: 500,
    }, gen1)
    guard.forceEnd()

    const gen2 = guard.tryStart()!
    const liveLease = guard.acquireLease({
      owner: 'bash',
      id: 'toolu_live',
      timeoutMs: 500,
    }, gen2)

    staleLease.release()
    vi.advanceTimersByTime(100)
    expect(guard.isActive).toBe(true)

    liveLease.release()
    guard.registerActivity('stale_api_stream', gen1)
    vi.advanceTimersByTime(100)
    expect(guard.isActive).toBe(false)
    expect(onTimeout).toHaveBeenCalledWith(gen2, 'idle')
  })

  test('timeout is cleared when end() is called normally', () => {
    vi.useFakeTimers()
    const guard = new QueryGuard()
    const gen = guard.tryStart()!
    guard.end(gen)

    // Advance past timeout — should not affect anything
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(guard.isActive).toBe(false)

    // Should be able to start a new query
    const gen2 = guard.tryStart()
    expect(gen2).not.toBeNull()
    expect(guard.isActive).toBe(true)

    guard.forceEnd()
  })
})

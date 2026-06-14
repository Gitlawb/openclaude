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

  test('timeout auto force-ends after 5 minutes', () => {
    vi.useFakeTimers()
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

  test('timeout notifies owner with the timed-out generation', () => {
    vi.useFakeTimers()
    const guard = new QueryGuard()
    const onTimeout = vi.fn()
    guard.setTimeoutHandler(onTimeout)

    const gen = guard.tryStart()!
    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout).toHaveBeenCalledWith(gen)
    expect(guard.isActive).toBe(false)
  })

  test('timeout handler cleanup prevents stale notification', () => {
    vi.useFakeTimers()
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

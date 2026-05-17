import { describe, test, expect, vi } from 'vitest'
import { QueryGuard } from './QueryGuard.js'

describe('QueryGuard', () => {
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

    vi.useRealTimers()
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
    vi.useRealTimers()
  })
})

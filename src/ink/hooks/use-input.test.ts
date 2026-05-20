import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test'

// Hoist the mock so it's available before module load
const mockSetRawMode = vi.fn()
const mockEventEmitter = { on: vi.fn(), removeListener: vi.fn(), emit: vi.fn() }

vi.mock('./use-stdin.js', () => ({
  default: () => ({
    setRawMode: mockSetRawMode,
    internal_exitOnCtrlC: false,
    internal_eventEmitter: mockEventEmitter,
  }),
}))

// Dynamic import after mock is registered
const { renderHook, act } = await import('@testing-library/react-hooks')
const useInput = (await import('./use-input.js')).default

describe('useInput — raw mode lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSetRawMode.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enables raw mode on mount when isActive is true (default)', () => {
    const handler = vi.fn()
    renderHook(() => useInput(handler))

    expect(mockSetRawMode).toHaveBeenCalledWith(true)
  })

  it('does NOT enable raw mode when isActive is false', () => {
    const handler = vi.fn()
    renderHook(() => useInput(handler, { isActive: false }))

    expect(mockSetRawMode).not.toHaveBeenCalled()
  })

  it('defers setRawMode(false) on unmount — fires after one tick', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useInput(handler))

    unmount()

    // Immediately after unmount, setRawMode(false) has NOT yet fired
    expect(mockSetRawMode).toHaveBeenCalledTimes(1) // only the initial true
    expect(mockSetRawMode).toHaveBeenCalledWith(true)

    // Advance timers — the deferred reset fires
    vi.advanceTimersByTime(1)

    expect(mockSetRawMode).toHaveBeenCalledTimes(2)
    expect(mockSetRawMode).toHaveBeenLastCalledWith(false)
  })

  it('cancels deferred reset on isActive false→true transition (MCP re-render churn)', () => {
    const handler = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ isActive }: { isActive: boolean }) => useInput(handler, { isActive }),
      { initialProps: { isActive: true } },
    )

    expect(mockSetRawMode).toHaveBeenCalledTimes(1)
    expect(mockSetRawMode).toHaveBeenCalledWith(true)

    // Toggle to inactive — effect cleanup schedules deferred reset
    rerender({ isActive: false })

    // Cleanup ran: timer scheduled but hasn't fired yet
    expect(mockSetRawMode).toHaveBeenCalledTimes(1)

    // Toggle back to active before timer fires — setup cancels pending reset
    rerender({ isActive: true })

    // Setup cleared the pending timer but did NOT call setRawMode(true)
    // because the counter was never decremented by the deferred reset.
    expect(mockSetRawMode).toHaveBeenCalledTimes(1)
    expect(mockSetRawMode).toHaveBeenLastCalledWith(true)

    // Advance timers — the cancelled reset should NOT fire
    vi.advanceTimersByTime(100)

    // Still only 1 call (no setRawMode(false), no redundant setRawMode(true))
    expect(mockSetRawMode).toHaveBeenCalledTimes(1)

    // Clean up: final unmount fires the deferred reset
    unmount()
    vi.advanceTimersByTime(1)

    expect(mockSetRawMode).toHaveBeenCalledTimes(2)
    expect(mockSetRawMode).toHaveBeenLastCalledWith(false)
  })

  it('handles isActive true → false transition: disables raw mode', () => {
    const handler = vi.fn()
    const { rerender } = renderHook(
      ({ isActive }) => useInput(handler, { isActive }),
      { initialProps: { isActive: true } },
    )

    expect(mockSetRawMode).toHaveBeenCalledWith(true)

    // Transition to inactive
    rerender({ isActive: false })

    // The effect cleanup from the previous isActive=true run
    // schedules a deferred reset
    vi.advanceTimersByTime(1)

    expect(mockSetRawMode).toHaveBeenLastCalledWith(false)
  })
})

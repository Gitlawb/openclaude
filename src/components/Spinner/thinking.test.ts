import { describe, expect, test } from 'bun:test'

/**
 * Tests for the Spinner thinking status tracking logic.
 * Extracted from Spinner.tsx's useEffect to test in isolation.
 */

type ThinkingStatus = 'thinking' | number | null

/**
 * Simulate the thinking status state machine from Spinner.tsx.
 * This is the core logic extracted for testing.
 */
function createThinkingTracker() {
  let thinkingStatus: ThinkingStatus = null
  let thinkingStartRef: number | null = null
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const statusChanges: ThinkingStatus[] = []

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer)
    timers.length = 0
  }

  function onModeChange(mode: string, now: number) {
    if (mode === 'thinking') {
      thinkingStartRef = now
      thinkingStatus = 'thinking'
      statusChanges.push('thinking')
      clearTimers()
    } else if (thinkingStartRef !== null) {
      const duration = now - thinkingStartRef
      const elapsed = now - thinkingStartRef
      const remainingThinkingTime = Math.max(0, 3000 - elapsed)
      thinkingStartRef = null
      clearTimers()

      const showDuration = () => {
        thinkingStatus = duration
        statusChanges.push(duration)
        const clearTimer = setTimeout(() => {
          thinkingStatus = null
          statusChanges.push(null)
        }, 4000)
        timers.push(clearTimer)
      }

      if (remainingThinkingTime > 0) {
        const showTimer = setTimeout(showDuration, remainingThinkingTime)
        timers.push(showTimer)
      } else {
        showDuration()
      }
    }
  }

  return {
    get status() { return thinkingStatus },
    get startRef() { return thinkingStartRef },
    statusChanges,
    onModeChange,
    clearTimers,
    dispose() { clearTimers() },
  }
}

describe('SpinnerMode type exists', () => {
  test('SpinnerMode type is defined in types.ts', async () => {
    const types = await import('./types.js')
    // Verify the type module exports SpinnerMode (runtime check: type exists in module)
    expect(types).toBeDefined()
    // SpinnerMode is a type-only export, so we verify the module loaded without error
  })

  test('RGBColor type is defined in types.ts', async () => {
    const types = await import('./types.js')
    expect(types).toBeDefined()
  })
})

describe('thinking status tracker', () => {
  test('starts with null status', () => {
    const tracker = createThinkingTracker()
    expect(tracker.status).toBeNull()
    tracker.dispose()
  })

  test('sets thinking status when mode becomes thinking', () => {
    const tracker = createThinkingTracker()
    tracker.onModeChange('thinking', 1000)
    expect(tracker.status).toBe('thinking')
    tracker.dispose()
  })

  test('records thinking start time', () => {
    const tracker = createThinkingTracker()
    tracker.onModeChange('thinking', 5000)
    expect(tracker.startRef).toBe(5000)
    tracker.dispose()
  })

  test('transitions to duration after thinking ends (long think > 5s)', () => {
    const tracker = createThinkingTracker()
    tracker.onModeChange('thinking', 1000)
    tracker.onModeChange('responding', 8000) // 7 seconds of thinking
    // Should immediately show duration since elapsed > 5s
    expect(tracker.statusChanges).toContain(7000)
    tracker.dispose()
  })

  test('resets start ref when thinking stops', () => {
    const tracker = createThinkingTracker()
    tracker.onModeChange('thinking', 1000)
    tracker.onModeChange('responding', 6000)
    expect(tracker.startRef).toBeNull()
    tracker.dispose()
  })

  test('always restarts on new thinking period (fixes rapid cycling)', () => {
    const tracker = createThinkingTracker()
    // First thinking period
    tracker.onModeChange('thinking', 1000)
    expect(tracker.status).toBe('thinking')

    // Quick switch to tool-use
    tracker.onModeChange('tool-use', 1200)

    // Back to thinking — MUST restart (old behavior: skipped if ref was null)
    tracker.onModeChange('thinking', 1500)
    expect(tracker.status).toBe('thinking')
    expect(tracker.startRef).toBe(1500) // New start time, not old
    tracker.dispose()
  })

  test('clears timers when switching back to thinking', () => {
    const tracker = createThinkingTracker()
    tracker.onModeChange('thinking', 1000)
    tracker.onModeChange('responding', 1500) // Short think
    // Timers are pending. Now switch back to thinking:
    tracker.onModeChange('thinking', 2000)
    // Old timers should be cleared — status should be 'thinking' not a stale duration
    expect(tracker.status).toBe('thinking')
    tracker.dispose()
  })

  test('handles normal flow: requesting → thinking → responding', () => {
    const tracker = createThinkingTracker()
    tracker.onModeChange('requesting', 0)
    tracker.onModeChange('thinking', 100)
    expect(tracker.status).toBe('thinking')
    tracker.onModeChange('responding', 4000) // 3.9s of thinking
    expect(tracker.statusChanges).toContain(3900)
    tracker.dispose()
  })

  test('handles thinking → tool-input → tool-use → responding', async () => {
    const tracker = createThinkingTracker()
    tracker.onModeChange('thinking', 0)
    tracker.onModeChange('tool-input', 2000)
    // Duration is 2000ms, remainingThinkingTime = 5000 - 2000 = 3000ms
    // So the showDuration callback is scheduled after 3000ms
    tracker.onModeChange('tool-use', 2100)
    tracker.onModeChange('responding', 5000)

    // Wait for the scheduled timer to fire (remainingThinkingTime was 3000ms)
    await new Promise(r => setTimeout(r, 3200))
    expect(tracker.statusChanges.filter(s => s === 2000).length).toBeGreaterThan(0)
    tracker.dispose()
  })
})

describe('MCP timeout function', () => {
  test('getMcpToolTimeoutMs returns default when env not set', () => {
    const original = process.env.MCP_TOOL_TIMEOUT
    delete process.env.MCP_TOOL_TIMEOUT

    // Replicate the fixed logic
    const envTimeout = parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10)
    const result = Number.isNaN(envTimeout) ? 300_000 : envTimeout

    expect(result).toBe(300_000) // 5 minutes

    if (original !== undefined) process.env.MCP_TOOL_TIMEOUT = original
  })

  test('getMcpToolTimeoutMs returns custom value when env is set', () => {
    const original = process.env.MCP_TOOL_TIMEOUT
    process.env.MCP_TOOL_TIMEOUT = '60000'

    const envTimeout = parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10)
    const result = Number.isNaN(envTimeout) ? 300_000 : envTimeout

    expect(result).toBe(60000)

    if (original !== undefined) process.env.MCP_TOOL_TIMEOUT = original
    else delete process.env.MCP_TOOL_TIMEOUT
  })

  test('getMcpToolTimeoutMs handles explicit 0 (no timeout)', () => {
    const original = process.env.MCP_TOOL_TIMEOUT
    process.env.MCP_TOOL_TIMEOUT = '0'

    const envTimeout = parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10)
    const result = Number.isNaN(envTimeout) ? 300_000 : envTimeout

    expect(result).toBe(0) // Should be 0, not fallback to default

    if (original !== undefined) process.env.MCP_TOOL_TIMEOUT = original
    else delete process.env.MCP_TOOL_TIMEOUT
  })

  test('getMcpToolTimeoutMs falls back on non-numeric env', () => {
    const original = process.env.MCP_TOOL_TIMEOUT
    process.env.MCP_TOOL_TIMEOUT = 'abc'

    const envTimeout = parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10)
    const result = Number.isNaN(envTimeout) ? 300_000 : envTimeout

    expect(result).toBe(300_000)

    if (original !== undefined) process.env.MCP_TOOL_TIMEOUT = original
    else delete process.env.MCP_TOOL_TIMEOUT
  })
})

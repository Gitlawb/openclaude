import { describe, expect, test } from 'bun:test'
import {
  createCircuitBreakerState,
  defaultCircuitConfig,
  observeToolResult,
} from './circuitBreakers.js'

describe('circuitBreakers', () => {
  test('trips after 3 identical tool errors', () => {
    const state = createCircuitBreakerState()
    const cfg = defaultCircuitConfig()
    expect(
      observeToolResult(state, { toolName: 'Bash', error: 'exit 1' }, cfg)
        .tripped,
    ).toBe(false)
    expect(
      observeToolResult(state, { toolName: 'Bash', error: 'exit 1' }, cfg)
        .tripped,
    ).toBe(false)
    const third = observeToolResult(
      state,
      { toolName: 'Bash', error: 'exit 1' },
      cfg,
    )
    expect(third.tripped).toBe(true)
    if (third.tripped) expect(third.code).toBe('same_tool_error')
  })

  test('different errors do not trip early', () => {
    const state = createCircuitBreakerState()
    observeToolResult(state, { toolName: 'Bash', error: 'a' })
    observeToolResult(state, { toolName: 'Bash', error: 'b' })
    const r = observeToolResult(state, { toolName: 'Bash', error: 'c' })
    expect(r.tripped).toBe(false)
  })

  test('trips on consecutive noop edits', () => {
    const state = createCircuitBreakerState()
    observeToolResult(state, { toolName: 'Edit', noopEdit: true })
    const r = observeToolResult(state, { toolName: 'Edit', noopEdit: true })
    expect(r.tripped).toBe(true)
    if (r.tripped) expect(r.code).toBe('noop_edits')
  })

  test('successful edit resets noop streak', () => {
    const state = createCircuitBreakerState()
    observeToolResult(state, { toolName: 'Edit', noopEdit: true })
    observeToolResult(state, { toolName: 'Edit', noopEdit: false })
    const r = observeToolResult(state, { toolName: 'Edit', noopEdit: true })
    expect(r.tripped).toBe(false)
  })

  test('max tools per turn', () => {
    const state = createCircuitBreakerState()
    const cfg = { ...defaultCircuitConfig(), maxToolsPerTurn: 2 }
    observeToolResult(state, { toolName: 'Read' }, cfg)
    observeToolResult(state, { toolName: 'Read' }, cfg)
    const r = observeToolResult(state, { toolName: 'Read' }, cfg)
    expect(r.tripped).toBe(true)
    if (r.tripped) expect(r.code).toBe('max_tools')
  })
})

import { describe, expect, it } from 'bun:test'

import { shouldRunStartupChecks } from './replStartupGates.js'

describe('shouldRunStartupChecks', () => {
  it('blocks startup checks while the user is actively typing', () => {
    expect(shouldRunStartupChecks(false, false, true)).toBe(false)
  })

  it('blocks startup checks after they already ran', () => {
    expect(shouldRunStartupChecks(false, true, false)).toBe(false)
  })

  it('blocks startup checks for remote sessions', () => {
    expect(shouldRunStartupChecks(true, false, false)).toBe(false)
  })

  it('allows startup checks once the session is local, idle, and not started', () => {
    expect(shouldRunStartupChecks(false, false, false)).toBe(true)
  })
})

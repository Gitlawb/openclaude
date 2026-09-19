import { describe, expect, test } from 'bun:test'
import {
  closeForegroundAgentForBackground,
  createForegroundAgentAbortController,
} from './foregroundAgentHandoff.js'

describe('foreground agent background handoff', () => {
  test('aborts the outgoing execution before closing its iterator', async () => {
    const parent = new AbortController()
    const foreground = createForegroundAgentAbortController(parent)
    let wasAbortedWhenCloseStarted = false

    await closeForegroundAgentForBackground(foreground, async () => {
      wasAbortedWhenCloseStarted = foreground.signal.aborted
    })

    expect(wasAbortedWhenCloseStarted).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  })

  test('still propagates a parent interruption to the foreground execution', () => {
    const parent = new AbortController()
    const foreground = createForegroundAgentAbortController(parent)

    parent.abort('user-cancel')

    expect(foreground.signal.aborted).toBe(true)
    expect(foreground.signal.reason).toBe('user-cancel')
  })

  test('preserves ordinary foreground abort propagation to the parent', () => {
    const parent = new AbortController()
    const foreground = createForegroundAgentAbortController(parent)

    foreground.abort('permission-rejected')

    expect(parent.signal.aborted).toBe(true)
    expect(parent.signal.reason).toBe('permission-rejected')
  })
})

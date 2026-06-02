import { afterEach, describe, expect, test } from 'bun:test'
import {
  activateProactive,
  deactivateProactive,
  isProactivePaused,
  setContextBlocked,
  subscribeToProactiveChanges,
} from './index.js'

describe('proactive state', () => {
  const unsubscribers: Array<() => void> = []

  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) {
      unsubscribe()
    }
    deactivateProactive()
  })

  test('activation clears a stale context block', () => {
    setContextBlocked(true)

    activateProactive()

    expect(isProactivePaused()).toBe(false)
  })

  test('one failing listener does not block later listeners or state changes', () => {
    let notified = false
    unsubscribers.push(
      subscribeToProactiveChanges(() => {
        throw new Error('listener failed')
      }),
    )
    unsubscribers.push(
      subscribeToProactiveChanges(() => {
        notified = true
      }),
    )

    expect(() => activateProactive()).not.toThrow()

    expect(notified).toBe(true)
    expect(isProactivePaused()).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { asSessionId } from '../../types/ids.js'
import {
  buildInactivePermissionSessionDecision,
  createPermissionSessionStateGetter,
  isPermissionSessionActive,
} from './permissionSessionOwnership.js'

describe('permission session ownership', () => {
  test('keeps legacy and matching contexts active', () => {
    const session = asSessionId('session-a')
    expect(isPermissionSessionActive(undefined, session)).toBe(true)
    expect(isPermissionSessionActive(session, session)).toBe(true)
  })

  test('retains owner state while another session is active', () => {
    let activeSessionId = asSessionId('session-a')
    let liveState = { mode: 'default' }
    const getOwnedState = createPermissionSessionStateGetter(
      asSessionId('session-a'),
      () => liveState,
      () => activeSessionId,
    )

    liveState = { mode: 'dontAsk' }
    expect(getOwnedState()).toEqual({ mode: 'dontAsk' })

    activeSessionId = asSessionId('session-b')
    liveState = { mode: 'fullAccess' }
    expect(getOwnedState()).toEqual({ mode: 'dontAsk' })

    activeSessionId = asSessionId('session-a')
    expect(getOwnedState()).toEqual({ mode: 'fullAccess' })
  })

  test('rejects a context owned by another session', () => {
    expect(
      isPermissionSessionActive(
        asSessionId('session-a'),
        asSessionId('session-b'),
      ),
    ).toBe(false)
    expect(buildInactivePermissionSessionDecision()).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'asyncAgent' },
    })
  })
})

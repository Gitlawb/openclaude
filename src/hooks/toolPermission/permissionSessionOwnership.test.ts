import { describe, expect, test } from 'bun:test'
import { asSessionId } from '../../types/ids.js'
import {
  buildInactivePermissionSessionDecision,
  isPermissionSessionActive,
} from './permissionSessionOwnership.js'

describe('permission session ownership', () => {
  test('keeps legacy and matching contexts active', () => {
    const session = asSessionId('session-a')
    expect(isPermissionSessionActive(undefined, session)).toBe(true)
    expect(isPermissionSessionActive(session, session)).toBe(true)
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

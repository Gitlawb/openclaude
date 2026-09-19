import { getSessionId } from '../../bootstrap/state.js'
import type { SessionId } from '../../types/ids.js'
import type { PermissionDenyDecision } from '../../types/permissions.js'

export function isPermissionSessionActive(
  permissionSessionId: SessionId | undefined,
  activeSessionId: SessionId = getSessionId(),
): boolean {
  return (
    permissionSessionId === undefined ||
    permissionSessionId === activeSessionId
  )
}

export function buildInactivePermissionSessionDecision(): PermissionDenyDecision {
  return {
    behavior: 'deny',
    message:
      'Permission denied because the agent\'s originating session is not active.',
    decisionReason: {
      type: 'asyncAgent',
      reason: 'originating session is not active',
    },
  }
}

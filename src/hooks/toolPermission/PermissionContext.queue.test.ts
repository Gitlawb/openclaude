import { describe, expect, test } from 'bun:test'
import type { Dispatch, SetStateAction } from 'react'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import { asSessionId } from '../../types/ids.js'
import { createPermissionQueueOps } from './PermissionContext.js'

function queueItem(
  permissionSessionId: ReturnType<typeof asSessionId>,
  label: string,
): ToolUseConfirm {
  return {
    toolUseID: 'shared-tool-id',
    permissionSessionId,
    label,
  } as unknown as ToolUseConfirm
}

describe('permission queue identity', () => {
  test('remove and update qualify duplicate tool IDs by owning session', () => {
    const sessionA = asSessionId('session-a')
    const sessionB = asSessionId('session-b')
    let queue = [queueItem(sessionA, 'a'), queueItem(sessionB, 'b')]
    const setQueue: Dispatch<SetStateAction<ToolUseConfirm[]>> = update => {
      queue = typeof update === 'function' ? update(queue) : update
    }
    const ops = createPermissionQueueOps(setQueue)

    ops.update('shared-tool-id', sessionA, {
      classifierCheckInProgress: true,
    })
    expect(queue[0]?.classifierCheckInProgress).toBe(true)
    expect(queue[1]?.classifierCheckInProgress).toBeUndefined()

    ops.remove('shared-tool-id', sessionB)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.permissionSessionId).toBe(sessionA)
  })
})

import type { PermissionUpdate } from '../../types/permissions.js'
import type { ToolUseConfirm } from './PermissionRequest.js'
import { logUnaryPermissionEvent } from './utils.js'

type DoneHandlers = {
  onDone: () => void
  onReject?: () => void
}

type PermissionUpdates = PermissionUpdate[] | (() => PermissionUpdate[])

type SimplePermissionOutcome =
  | {
      behavior: 'allow'
      updates?: PermissionUpdates
      includeFeedback?: boolean
    }
  | {
      behavior: 'reject'
      includeFeedback?: boolean
    }

type PermissionAction =
  | {
      behavior: 'allow'
      updates?: PermissionUpdate[]
      feedback?: string
      input?: unknown
    }
  | {
      behavior: 'reject'
      feedback?: string
    }

export function executePermissionAction(
  toolUseConfirm: ToolUseConfirm,
  { onDone, onReject }: DoneHandlers,
  action: PermissionAction,
): void {
  if (action.behavior === 'allow') {
    onDone()
    toolUseConfirm.onAllow(
      (action.input ?? toolUseConfirm.input) as never,
      action.updates ?? [],
      action.feedback,
    )
    return
  }

  onDone()
  onReject?.()
  toolUseConfirm.onReject(action.feedback)
}

export function allowPermission(
  toolUseConfirm: ToolUseConfirm,
  { onDone }: DoneHandlers,
  updates: PermissionUpdate[] = [],
  feedback?: string,
): void {
  logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
  executePermissionAction(toolUseConfirm, { onDone }, {
    behavior: 'allow',
    updates,
    feedback,
  })
}

export function rejectPermission(
  toolUseConfirm: ToolUseConfirm,
  { onDone, onReject }: DoneHandlers,
  feedback?: string,
): void {
  logUnaryPermissionEvent(
    'tool_use_single',
    toolUseConfirm,
    'reject',
    !!feedback,
  )
  executePermissionAction(toolUseConfirm, { onDone, onReject }, {
    behavior: 'reject',
    feedback,
  })
}

export function createSimplePermissionHandlers<T extends string>(
  toolUseConfirm: ToolUseConfirm,
  handlers: DoneHandlers,
  outcomes: Record<T, SimplePermissionOutcome | (() => SimplePermissionOutcome)>,
): {
  onSelect: (value: T, feedback?: string) => void
  onCancel: () => void
} {
  const onSelect = (value: T, feedback?: string) => {
    const outcomeOrFactory = outcomes[value]
    const outcome: SimplePermissionOutcome =
      typeof outcomeOrFactory === 'function'
        ? outcomeOrFactory()
        : outcomeOrFactory

    if (outcome.behavior === 'allow') {
      const resolvedUpdates =
        typeof outcome.updates === 'function'
          ? outcome.updates()
          : outcome.updates ?? []
      allowPermission(
        toolUseConfirm,
        handlers,
        resolvedUpdates,
        outcome.includeFeedback ? feedback : undefined,
      )
      return
    }

    rejectPermission(
      toolUseConfirm,
      handlers,
      outcome.includeFeedback ? feedback : undefined,
    )
  }

  const onCancel = () => rejectPermission(toolUseConfirm, handlers)

  return {
    onSelect,
    onCancel,
  }
}

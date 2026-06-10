import type { ToolPermissionContext } from '../../Tool.js'
import type { DangerousPermissionMode } from './dangerousModePrompt.js'
import type { PermissionMode } from './PermissionMode.js'
import {
  getPermissionModeChangeRequestDecision,
  type PermissionModeChangeRequestDecision,
} from './permissionSetup.js'

type PermissionModeChangeContext = Pick<
  ToolPermissionContext,
  'isBypassPermissionsModeAvailable'
>

type RequestPermissionModeChangeDeps = {
  getPermissionModeChangeRequestDecision: (args: {
    mode: PermissionMode
    toolPermissionContext: PermissionModeChangeContext
    allowDangerousModeConfirmation?: boolean
    allowSessionBypassPermissionsModeEnable?: boolean
    skipDangerousModePrompt?: boolean
    requireLocalConfirmation?: boolean
  }) => Promise<PermissionModeChangeRequestDecision>
}

const DEFAULT_DEPS: RequestPermissionModeChangeDeps = {
  getPermissionModeChangeRequestDecision,
}

export type RequestPermissionModeChangeResult =
  | { status: 'applied' }
  | { status: 'blocked'; error: string }
  | { status: 'confirm-pending'; mode: DangerousPermissionMode }

export type RequestPermissionModeChangeOptions = {
  mode: PermissionMode
  toolPermissionContext: PermissionModeChangeContext
  onApply: () => void | Promise<void>
  onBlocked?: (error: string) => void
  allowDangerousModeConfirmation?: boolean
  allowSessionBypassPermissionsModeEnable?: boolean
  skipDangerousModePrompt?: boolean
  requireLocalConfirmation?: boolean
  onConfirmDangerousMode?: (
    mode: DangerousPermissionMode,
    onConfirm: () => void,
  ) => void
  deps?: RequestPermissionModeChangeDeps
}

export async function requestPermissionModeChange({
  mode,
  toolPermissionContext,
  onApply,
  onBlocked,
  allowDangerousModeConfirmation = true,
  allowSessionBypassPermissionsModeEnable = false,
  skipDangerousModePrompt = false,
  requireLocalConfirmation,
  onConfirmDangerousMode,
  deps = DEFAULT_DEPS,
}: RequestPermissionModeChangeOptions): Promise<RequestPermissionModeChangeResult> {
  const modeDecision = await deps.getPermissionModeChangeRequestDecision({
    mode,
    toolPermissionContext,
    allowDangerousModeConfirmation,
    allowSessionBypassPermissionsModeEnable,
    skipDangerousModePrompt,
    requireLocalConfirmation,
  })

  if (modeDecision.status === 'blocked') {
    onBlocked?.(modeDecision.error)
    return {
      status: 'blocked',
      error: modeDecision.error,
    }
  }

  if (modeDecision.status === 'confirm') {
    if (!onConfirmDangerousMode) {
      const error = `Cannot set permission mode to ${mode} without a dangerous-mode confirmation handler`
      onBlocked?.(error)
      return {
        status: 'blocked',
        error,
      }
    }

    onConfirmDangerousMode(modeDecision.mode, () => {
      void requestPermissionModeChange({
        mode,
        toolPermissionContext,
        onApply,
        onBlocked,
        allowDangerousModeConfirmation,
        allowSessionBypassPermissionsModeEnable,
        skipDangerousModePrompt: true,
        requireLocalConfirmation,
        onConfirmDangerousMode,
        deps,
      })
    })

    return {
      status: 'confirm-pending',
      mode: modeDecision.mode,
    }
  }

  await onApply()
  return { status: 'applied' }
}

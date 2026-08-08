import React from 'react'
import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js'
import { requestPermissionModeChange as runPermissionModeChangeRequest } from '../../utils/permissions/permissionModeChange.js'
import { useDangerousModeConfirmation } from './useDangerousModeConfirmation.js'

type PermissionModeChangeRequest = {
  mode: PermissionMode
  toolPermissionContext: Pick<
    ToolPermissionContext,
    'isBypassPermissionsModeAvailable'
  >
  onApply: () => void
  onBlocked?: (error: string) => void
  allowDangerousModeConfirmation?: boolean
  allowSessionBypassPermissionsModeEnable?: boolean
  skipDangerousModePrompt?: boolean
  requireLocalConfirmation?: boolean
}

export function usePermissionModeChangeRequest() {
  const {
    dangerousModeDialog,
    isConfirmingDangerousMode,
    requestDangerousModeConfirmation,
  } = useDangerousModeConfirmation()

  const requestPermissionModeChange = React.useCallback(
    async ({
      mode,
      toolPermissionContext,
      onApply,
      onBlocked,
      allowDangerousModeConfirmation = true,
      allowSessionBypassPermissionsModeEnable = false,
      skipDangerousModePrompt = false,
      requireLocalConfirmation,
    }: PermissionModeChangeRequest): Promise<boolean> => {
      const result = await runPermissionModeChangeRequest({
        mode,
        toolPermissionContext,
        onApply,
        onBlocked,
        allowDangerousModeConfirmation,
        allowSessionBypassPermissionsModeEnable,
        skipDangerousModePrompt,
        requireLocalConfirmation,
        onConfirmDangerousMode: requestDangerousModeConfirmation,
      })

      return result.status === 'applied'
    },
    [requestDangerousModeConfirmation],
  )

  return {
    dangerousModeDialog,
    isConfirmingDangerousMode,
    requestPermissionModeChange,
  }
}

import React from 'react'
import { BypassPermissionsModeDialog } from '../BypassPermissionsModeDialog.js'
import type { DangerousPermissionMode } from '../../utils/permissions/dangerousModePrompt.js'
import {
  getStartupDangerousPermissionPromptState,
  persistDangerousModeAcceptance,
} from '../../utils/permissions/dangerousModePromptRuntime.js'

export function useDangerousModeConfirmation() {
  const [pendingMode, setPendingMode] =
    React.useState<DangerousPermissionMode | null>(null)
  const continuationRef = React.useRef<(() => void) | null>(null)

  const requestDangerousModeConfirmation = React.useCallback(
    (mode: DangerousPermissionMode, onConfirm: () => void) => {
      continuationRef.current = onConfirm
      setPendingMode(mode)
    },
    [],
  )

  const clearPendingDangerousMode = React.useCallback(() => {
    continuationRef.current = null
    setPendingMode(null)
  }, [])

  const confirmDangerousMode = React.useCallback(
    (mode: DangerousPermissionMode, onConfirm: () => void) => {
      const promptState = getStartupDangerousPermissionPromptState({
        permissionMode: mode,
        allowDangerouslySkipPermissions: false,
      })

      if (!promptState.shouldShow || !promptState.mode) {
        onConfirm()
        return
      }

      requestDangerousModeConfirmation(promptState.mode, onConfirm)
    },
    [requestDangerousModeConfirmation],
  )

  const handleDangerousModeAccept = React.useCallback(() => {
    const continuation = continuationRef.current
    continuationRef.current = null
    if (pendingMode) {
      persistDangerousModeAcceptance(pendingMode)
    }
    setPendingMode(null)
    continuation?.()
  }, [pendingMode])

  const dangerousModeDialog = pendingMode ? (
    <BypassPermissionsModeDialog
      mode={pendingMode}
      onAccept={handleDangerousModeAccept}
      onDecline={clearPendingDangerousMode}
      onCancel={clearPendingDangerousMode}
    />
  ) : null

  return {
    confirmDangerousMode,
    dangerousModeDialog,
    isConfirmingDangerousMode: pendingMode !== null,
    requestDangerousModeConfirmation,
  }
}

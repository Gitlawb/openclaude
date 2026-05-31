import React from 'react'
import type { Root } from '../../ink.js'
import { BypassPermissionsModeDialog } from '../../components/BypassPermissionsModeDialog.js'
import type { PermissionMode } from './PermissionMode.js'
import {
  getStartupDangerousPermissionPromptState,
  persistDangerousModeAcceptance,
} from './dangerousModePromptRuntime.js'

type DangerousModePromptFlowDeps = {
  DialogComponent: typeof BypassPermissionsModeDialog
  getPromptState: typeof getStartupDangerousPermissionPromptState
  persistAcceptance: typeof persistDangerousModeAcceptance
}

export async function showDangerousModePromptIfNeeded(
  root: Root,
  permissionMode: PermissionMode,
  allowDangerouslySkipPermissions: boolean,
  showSetupDialog: <T = void>(
    root: Root,
    renderer: (done: (result: T) => void) => React.ReactNode,
  ) => Promise<T>,
  deps: Partial<DangerousModePromptFlowDeps> = {},
): Promise<boolean> {
  const DialogComponent = deps.DialogComponent ?? BypassPermissionsModeDialog
  const getPromptState =
    deps.getPromptState ?? getStartupDangerousPermissionPromptState
  const persistAcceptance =
    deps.persistAcceptance ?? persistDangerousModeAcceptance

  const dangerousPromptState = getPromptState({
    permissionMode,
    allowDangerouslySkipPermissions,
  })

  if (!dangerousPromptState.shouldShow || !dangerousPromptState.mode) {
    return false
  }

  await showSetupDialog(root, done => (
    <DialogComponent
      mode={dangerousPromptState.mode}
      onAccept={() => {
        persistAcceptance(dangerousPromptState.mode!)
        done()
      }}
    />
  ))
  return true
}

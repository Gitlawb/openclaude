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

function PersistingDangerousModeDialog({
  DialogComponent,
  mode,
  persistAcceptance,
  done,
}: {
  DialogComponent: typeof BypassPermissionsModeDialog
  mode: Exclude<ReturnType<typeof getStartupDangerousPermissionPromptState>['mode'], null>
  persistAcceptance: typeof persistDangerousModeAcceptance
  done: () => void
}): React.ReactNode {
  const [saveError, setSaveError] = React.useState<string | null>(null)
  return (
    <DialogComponent
      mode={mode}
      saveError={saveError}
      onAccept={() => {
        const error = persistAcceptance(mode)
        if (error) {
          setSaveError(error)
          return
        }
        done()
      }}
    />
  )
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
  // Capture so the non-null narrowing survives into the render callback
  const dangerousMode = dangerousPromptState.mode

  await showSetupDialog(root, done => (
    <PersistingDangerousModeDialog
      DialogComponent={DialogComponent}
      mode={dangerousMode}
      persistAcceptance={persistAcceptance}
      done={done}
    />
  ))
  return true
}

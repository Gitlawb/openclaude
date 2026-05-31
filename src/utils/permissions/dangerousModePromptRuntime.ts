import {
  hasSkipDangerousModePermissionPrompt,
  hasSkipFullAccessModePermissionPrompt,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { PermissionMode } from './PermissionMode.js'
import {
  getDangerousModeAcceptanceUpdate,
  getDangerousPermissionPromptState,
  type DangerousPermissionMode,
} from './dangerousModePrompt.js'

export function getStartupDangerousPermissionPromptState({
  permissionMode,
  allowDangerouslySkipPermissions,
}: {
  permissionMode: PermissionMode
  allowDangerouslySkipPermissions: boolean
}): {
  mode: DangerousPermissionMode | null
  shouldShow: boolean
} {
  return getDangerousPermissionPromptState({
    permissionMode,
    allowDangerouslySkipPermissions,
    hasAcceptedBypassPermissionsPrompt:
      hasSkipDangerousModePermissionPrompt(),
    hasAcceptedFullAccessPrompt: hasSkipFullAccessModePermissionPrompt(),
  })
}

export function persistDangerousModeAcceptance(
  mode: DangerousPermissionMode,
): void {
  updateSettingsForSource('userSettings', getDangerousModeAcceptanceUpdate(mode))
}

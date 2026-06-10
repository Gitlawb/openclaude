import type { PermissionMode } from './PermissionMode.js'

export type DangerousPermissionMode = Extract<
  PermissionMode,
  'bypassPermissions' | 'fullAccess'
>

export function getDangerousPermissionPromptState({
  permissionMode,
  allowDangerouslySkipPermissions,
  hasAcceptedBypassPermissionsPrompt,
  hasAcceptedFullAccessPrompt,
}: {
  permissionMode: PermissionMode
  allowDangerouslySkipPermissions: boolean
  hasAcceptedBypassPermissionsPrompt: boolean
  hasAcceptedFullAccessPrompt: boolean
}): {
  mode: DangerousPermissionMode | null
  shouldShow: boolean
} {
  const requiresDangerousModePrompt =
    permissionMode === 'bypassPermissions' ||
    permissionMode === 'fullAccess' ||
    allowDangerouslySkipPermissions

  if (!requiresDangerousModePrompt) {
    return { mode: null, shouldShow: false }
  }

  const mode: DangerousPermissionMode =
    permissionMode === 'fullAccess' ? 'fullAccess' : 'bypassPermissions'

  const hasAcceptedPrompt =
    mode === 'fullAccess'
      ? hasAcceptedFullAccessPrompt
      : hasAcceptedBypassPermissionsPrompt

  return {
    mode,
    shouldShow: !hasAcceptedPrompt,
  }
}

export function getDangerousModeAcceptanceUpdate(
  mode: DangerousPermissionMode,
): {
  skipDangerousModePermissionPrompt?: true
  skipFullAccessModePermissionPrompt?: true
} {
  if (mode === 'fullAccess') {
    return { skipFullAccessModePermissionPrompt: true }
  }

  return { skipDangerousModePermissionPrompt: true }
}

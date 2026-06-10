import { feature } from 'bun:bundle'

import type { OptionWithDescription } from '../../../components/CustomSelect/select.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import type { PermissionMode } from '../../../utils/permissions/PermissionMode.js'
import {
  getModeColor,
  permissionModeTitle,
} from '../../../utils/permissions/PermissionMode.js'

export type ManageablePermissionMode = Extract<
  PermissionMode,
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'auto'
  | 'bypassPermissions'
  | 'fullAccess'
>

const MODE_DESCRIPTIONS: Record<ManageablePermissionMode, string> = {
  default: 'Standard behavior; prompts for dangerous operations.',
  acceptEdits: 'Auto-accept file edit operations in the workspace.',
  plan: 'Analysis only; tool execution is blocked.',
  auto: 'Use classifier-driven approvals when available.',
  bypassPermissions:
    'Skip normal permission prompts while preserving hard safety prompts.',
  fullAccess:
    'Skip normal permission prompts and hard safety-check prompts.',
}

export function getManageablePermissionModes(
  context: ToolPermissionContext,
): ManageablePermissionMode[] {
  const modes: ManageablePermissionMode[] = ['default', 'acceptEdits', 'plan']

  if (
    feature('TRANSCRIPT_CLASSIFIER') &&
    (context.isAutoModeAvailable || context.mode === 'auto')
  ) {
    modes.push('auto')
  }

  modes.push('bypassPermissions', 'fullAccess')

  return modes
}

export function getPermissionModeOptions(
  context: ToolPermissionContext,
): OptionWithDescription<ManageablePermissionMode>[] {
  return getManageablePermissionModes(context).map(mode => ({
    label:
      mode === context.mode
        ? `${permissionModeTitle(mode)} (current)`
        : permissionModeTitle(mode),
    value: mode,
    description: MODE_DESCRIPTIONS[mode],
    color:
      mode === 'bypassPermissions' || mode === 'fullAccess'
        ? getModeColor(mode)
        : undefined,
  }))
}

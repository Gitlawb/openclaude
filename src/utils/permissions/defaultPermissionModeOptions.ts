import { feature } from 'bun:bundle'

import {
  EXTERNAL_PERMISSION_MODES,
  PERMISSION_MODES,
  type PermissionMode,
} from './PermissionMode.js'

/**
 * Default-mode settings intentionally exclude the dangerous always-on modes.
 * Those remain available via explicit session/CLI flows, but not as a normal
 * persisted picker choice.
 */
export function getDefaultPermissionModeOptions(
  showAutoInDefaultModePicker: boolean,
): PermissionMode[] {
  const priorityOrder: PermissionMode[] = ['default', 'plan']
  const allModes: readonly PermissionMode[] = feature('TRANSCRIPT_CLASSIFIER')
    ? PERMISSION_MODES
    : EXTERNAL_PERMISSION_MODES
  const excluded: PermissionMode[] = ['bypassPermissions', 'fullAccess']

  if (feature('TRANSCRIPT_CLASSIFIER') && !showAutoInDefaultModePicker) {
    excluded.push('auto')
  }

  return [
    ...priorityOrder,
    ...allModes.filter(
      mode => !priorityOrder.includes(mode) && !excluded.includes(mode),
    ),
  ]
}

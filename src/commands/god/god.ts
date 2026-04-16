import type { LocalCommandCall } from '../../types/command.js'
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

/**
 * God mode: auto-approve every tool call in this session AND persist the
 * setting to .openclaude/settings.local.json so future sessions in this
 * project launch straight into bypassPermissions without CLI flags.
 *
 * Equivalent to running the CLI with --dangerously-skip-permissions.
 */
export const call: LocalCommandCall = async (_, context) => {
  const { getAppState, setAppState } = context

  // 1. Flip the current session to bypassPermissions so the change is
  //    immediate — no need to restart to benefit from it.
  setAppState(prev => ({
    ...prev,
    toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, {
      type: 'setMode',
      mode: 'bypassPermissions',
      destination: 'session',
    }),
  }))

  // 2. Persist to .openclaude/settings.local.json (gitignored, per-machine).
  //    Merge into any existing permissions block rather than overwriting.
  const existing = getSettingsForSource('localSettings') ?? {}
  const existingPermissions = existing.permissions ?? {}

  const { error } = updateSettingsForSource('localSettings', {
    ...existing,
    permissions: {
      ...existingPermissions,
      // Mirrors --dangerously-skip-permissions: boot straight into bypass.
      defaultMode: 'bypassPermissions',
      // Mirrors --allow-dangerously-skip-permissions: make the mode available
      // even if no CLI flag is passed.
      allowBypassPermissionsMode: true,
    },
  })

  if (error) {
    return {
      type: 'text',
      value:
        'Режим бога увімкнено лише для цієї сесії — не вдалося зберегти ' +
        `.openclaude/settings.local.json: ${error.message}`,
    }
  }

  return {
    type: 'text',
    value:
      'Режим бога увімкнено. Всі дозволи тепер оминаються — як із прапорцем ' +
      '--dangerously-skip-permissions. Налаштування збережено в ' +
      '.openclaude/settings.local.json, тому наступні сесії в цьому проєкті ' +
      'стартують так само.',
  }
}

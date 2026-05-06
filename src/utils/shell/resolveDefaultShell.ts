import { isEnvTruthy } from '../envUtils.js'
import { getPlatform } from '../platform.js'
import { getInitialSettings } from '../settings/settings.js'

/**
 * Resolve the default shell for input-box `!` commands.
 *
 * Resolution order (docs/design/ps-shell-selection.md §4.2):
 *   settings.defaultShell -> (Windows + OPENCLAUDE_USE_POWERSHELL_TOOL) -> 'bash'
 *
 * Platform default is 'bash' on all platforms, unless the user has explicitly
 * opted into PowerShell via OPENCLAUDE_USE_POWERSHELL_TOOL=true on Windows.
 * This restores the upstream behavior where setting the env var also makes
 * PowerShell the default for ! commands without requiring a separate
 * settings.defaultShell change.
 */
export function resolveDefaultShell(): 'bash' | 'powershell' {
  return getInitialSettings().defaultShell ??
    (getPlatform() === 'windows' && isEnvTruthy(process.env.OPENCLAUDE_USE_POWERSHELL_TOOL)
      ? 'powershell'
      : 'bash')
}

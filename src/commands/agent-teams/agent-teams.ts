import chalk from 'chalk'
import { isAgentSwarmsEnabled, isAgentSwarmsOptedIn } from '../../utils/agentSwarmsEnabled.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js'
import type { SettingSource } from '../../utils/settings/constants.js'
import type { LocalCommandCall } from '../../types/command.js'

/**
 * Sources that override userSettings, in descending priority order.
 * Listed highest-priority first so findOverridingSource() reports the
 * most authoritative source when multiple sources set the env var.
 * Priority: policySettings > flagSettings > localSettings > projectSettings > userSettings
 */
const HIGHER_PRIORITY_SOURCES: SettingSource[] = [
  'policySettings',
  'flagSettings',
  'localSettings',
  'projectSettings',
]

/**
 * Check if a higher-priority settings source is actively *enabling* agent teams.
 * Only returns a source when its value is truthy — a source with value '0' is
 * trying to disable the feature, not override the user setting, so we don't
 * report it as the cause (the --agent-teams CLI flag would be the actual cause
 * in that case).
 */
function findOverridingSource(): SettingSource | undefined {
  for (const source of HIGHER_PRIORITY_SOURCES) {
    const settings = getSettingsForSource(source)
    const value = settings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    if (isEnvTruthy(value)) {
      return source
    }
  }
  return undefined
}

/**
 * Check if a higher-priority settings source is actively *disabling* agent teams.
 * Returns the most authoritative source that explicitly sets the env var to a
 * falsy value. Used to prevent a userSettings write from overriding policy via
 * direct process.env mutation.
 */
function findBlockingSource(): SettingSource | undefined {
  for (const source of HIGHER_PRIORITY_SOURCES) {
    const settings = getSettingsForSource(source)
    const value = settings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    // Only report sources that explicitly set the var to a falsy value —
    // an absent value means the source has no opinion.
    if (value !== undefined && !isEnvTruthy(value)) {
      return source
    }
  }
  return undefined
}

export const call: LocalCommandCall = async (args) => {
  // In ant builds, agent teams are always enabled and cannot be toggled
  if (process.env.USER_TYPE === 'ant') {
    return {
      type: 'text',
      value: chalk.yellow('Agent teams are always enabled in ant builds.'),
    }
  }

  const trimmed = args.trim().toLowerCase()

  let enable: boolean
  if (trimmed === 'on') {
    enable = true
  } else if (trimmed === 'off') {
    enable = false
  } else if (trimmed === '') {
    // Toggle current state based on opt-in signal only (not the killswitch)
    enable = !isAgentSwarmsOptedIn()
  } else {
    return {
      type: 'text',
      value: chalk.red(`Invalid argument: "${trimmed}". Use /agent-teams [on|off]`),
    }
  }

  // Persist in user settings first; only update process.env if the write succeeds
  // to avoid leaving runtime state out of sync when the settings file is corrupt.
  const result = updateSettingsForSource('userSettings', {
    env: {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: enable ? '1' : '0',
    },
  })

  if (result.error) {
    return {
      type: 'text',
      value: chalk.red(`Failed to update settings: ${result.error.message}`),
    }
  }

  // Settings write succeeded — now apply to current session, but only if no
  // higher-priority source is actively overriding us in the opposite direction.
  if (enable) {
    // Do NOT mutate process.env if a higher-priority source (e.g. policySettings)
    // explicitly disables the feature — that would bypass the policy for the
    // lifetime of this process even though the settings layer is authoritative.
    const blockingSource = findBlockingSource()
    if (blockingSource) {
      return {
        type: 'text',
        value: chalk.yellow(
          `Agent teams user setting saved as enabled, but ${blockingSource} is overriding it with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS disabled. ` +
            `Remove the env entry from ${blockingSource} to enable agent teams.`,
        ),
      }
    }
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
  } else {
    // Do NOT mutate process.env if a higher-priority source (e.g. policySettings)
    // is enforcing enablement — deleting the var would bypass that policy for the
    // lifetime of this process.
    const overridingSource = findOverridingSource()
    if (overridingSource) {
      return {
        type: 'text',
        value: chalk.yellow(
          `Agent teams user setting saved as disabled, but ${overridingSource} is overriding it with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS enabled. ` +
            `Remove the env entry from ${overridingSource} to fully disable.`,
        ),
      }
    }
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  }

  // Re-check actual runtime state after applying the toggle.
  // isAgentSwarmsEnabled() also checks the GrowthBook killswitch,
  // so we report the effective state, not just what was requested.
  const effectivelyEnabled = isAgentSwarmsEnabled()
  if (enable && !effectivelyEnabled) {
    return {
      type: 'text',
      value: chalk.yellow(
        'Agent teams could not be enabled — the feature is currently disabled by the server. Try again later.',
      ),
    }
  }

  if (!enable && effectivelyEnabled) {
    // Check for higher-priority settings source override first
    const overridingSource = findOverridingSource()
    if (overridingSource) {
      return {
        type: 'text',
        value: chalk.yellow(
          `Agent teams user setting saved as disabled, but ${overridingSource} is overriding it with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS. ` +
            `Remove the env entry from ${overridingSource} to fully disable.`,
        ),
      }
    }
    // Otherwise the CLI flag --agent-teams keeps the feature on
    return {
      type: 'text',
      value: chalk.yellow(
        'Agent teams setting saved as disabled, but the --agent-teams CLI flag is keeping it enabled for this session. ' +
          'Restart without the flag to fully disable.',
      ),
    }
  }

  const status = effectivelyEnabled ? chalk.green('enabled') : chalk.yellow('disabled')
  return {
    type: 'text',
    value: `Agent teams ${status}`,
  }
}

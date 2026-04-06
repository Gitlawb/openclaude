import chalk from 'chalk'
import { isAgentSwarmsEnabled, isAgentSwarmsOptedIn } from '../../utils/agentSwarmsEnabled.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (args) => {
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

  // Update process.env for immediate effect this session
  if (enable) {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
  } else {
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  }

  // Persist in user settings so it survives restarts
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

  const status = effectivelyEnabled ? chalk.green('enabled') : chalk.yellow('disabled')
  return {
    type: 'text',
    value: `Agent teams ${status}`,
  }
}

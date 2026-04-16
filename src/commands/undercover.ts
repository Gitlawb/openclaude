import {
  getUndercoverActive,
  setUndercoverActive,
} from '../bootstrap/state.js'
import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'

const call: LocalCommandCall = async args => {
  const arg = args.trim().toLowerCase()

  if (arg === '' || arg === 'status') {
    return {
      type: 'text',
      value: `Undercover: ${getUndercoverActive() ? 'on' : 'off'}\nUse "/undercover on" or "/undercover off" to toggle. Default is on; launch with OPENCLAUDE_UNDERCOVER=0 to start off.`,
    }
  }

  if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === '1') {
    setUndercoverActive(true)
    return {
      type: 'text',
      value:
        'Undercover mode enabled. Model self-identification suppressed, commit/PR attribution stripped, anti-identification instructions added to agent prompts. Note: already-built system prompts in the current turn may be cached; the change takes full effect on the next message.',
    }
  }

  if (arg === 'off' || arg === 'disable' || arg === 'false' || arg === '0') {
    setUndercoverActive(false)
    return {
      type: 'text',
      value:
        'Undercover mode disabled. Co-Authored-By and attribution restored on next commit/PR. Model self-identification restored in the next system prompt.',
    }
  }

  if (arg === 'toggle') {
    const next = !getUndercoverActive()
    setUndercoverActive(next)
    return {
      type: 'text',
      value: `Undercover toggled: ${next ? 'on' : 'off'}`,
    }
  }

  return {
    type: 'text',
    value: `Unknown argument "${arg}". Usage: /undercover [on|off|toggle|status]`,
  }
}

const undercover = {
  type: 'local',
  name: 'undercover',
  description:
    'Toggle undercover mode: hide model self-identification, strip AI attribution from commits/PRs',
  argumentHint: '[on|off|toggle|status]',
  isEnabled: () => true,
  isHidden: false,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default undercover

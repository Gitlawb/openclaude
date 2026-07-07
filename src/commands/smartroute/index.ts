import type { Command } from '../../commands.js'
import type { LocalCommandCall } from '../../types/command.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { readSmartRouting } from '../../services/api/smartRouting/settings.js'
import {
  clearSmartRoutingSessionDisable,
  getKnownInputCost,
  isSmartRoutingDisabledForSession,
  resolveSmartRoutingRoleModelString,
} from '../../services/api/smartRouting/index.js'
import { getSessionId } from '../../bootstrap/state.js'

type SmartRoutingSettings = NonNullable<SettingsJson['smartRouting']>

const HELP =
  'Usage:\n' +
  '  /smartroute            show status\n' +
  '  /smartroute on|off     enable / disable\n' +
  '  /smartroute simple <agentModels-key>\n' +
  '  /smartroute strong <agentModels-key>'

function text(value: string) {
  return { type: 'text' as const, value }
}

/**
 * Warn when both roles have first-party reference pricing and, by that pricing,
 * simple is not actually cheaper. The numbers are first-party list prices, not
 * the active provider's, so the warning is hedged accordingly.
 */
function cheaperWarning(s: SmartRoutingSettings, settings: SettingsJson | null): string {
  const simple = getKnownInputCost(resolveSmartRoutingRoleModelString(s.simpleModel, settings) ?? '')
  const strong = getKnownInputCost(resolveSmartRoutingRoleModelString(s.strongModel, settings) ?? '')
  if (simple != null && strong != null && simple >= strong) {
    return `\nHeads up: by first-party reference pricing the simple model is not cheaper than the strong model (${simple} vs ${strong} per Mtok input); your provider may bill differently. Smart routing may not save money.`
  }
  return ''
}

function formatPersistError(error: Error): string {
  return `Failed to update smart routing settings: ${error.message}`
}

function readCurrentSmartRouting(settings: SettingsJson): SmartRoutingSettings {
  if (settings.smartRouting !== undefined) return { ...settings.smartRouting }
  const normalized = readSmartRouting(settings)
  if (!normalized.enabled) return {}
  return { ...normalized }
}

const call: LocalCommandCall = async (args, context) => {
  const arg = args.trim()
  const settings = context.getAppState().settings as unknown as SettingsJson
  const current = readCurrentSmartRouting(settings)
  const agentModelKeys = Object.keys(settings?.agentModels ?? {})

  const persist = (next: SmartRoutingSettings): Error | null => {
    const { error } = updateSettingsForSource('userSettings', { smartRouting: next })
    if (error) return error
    context.setAppState(s => ({
      ...s,
      settings: { ...s.settings, smartRouting: next },
    }))
    return null
  }

  // Status (no args).
  if (!arg) {
    const normalized = readSmartRouting(settings)
    const disabledForSession = isSmartRoutingDisabledForSession(getSessionId())
    const lines = [
      'Smart routing (experimental)',
      `  status: ${normalized.enabled ? 'enabled' : 'disabled'}${
        disabledForSession ? ' (auto-disabled this session: both models outside the org allowlist)' : ''
      }`,
      `  simple: ${normalized.simpleModel ?? '(unset)'}`,
      `  strong: ${normalized.strongModel ?? '(unset)'}`,
    ]
    if (agentModelKeys.length > 0) lines.push(`  available agentModels keys: ${agentModelKeys.join(', ')}`)
    return text(lines.join('\n') + '\n\n' + HELP)
  }

  const [sub, value] = arg.split(/\s+/, 2)
  const lower = sub.toLowerCase()

  if (lower === 'on') {
    if (!current.strongModel || !current.simpleModel) {
      return text('Set both roles first: /smartroute simple <key> and /smartroute strong <key>.')
    }
    const next = { ...current, enabled: true }
    const error = persist(next)
    if (error) return text(formatPersistError(error))
    // Re-enabling clears any session auto-disable.
    clearSmartRoutingSessionDisable(getSessionId())
    return text(`Smart routing enabled (simple=${next.simpleModel}, strong=${next.strongModel}).${cheaperWarning(next, settings)}`)
  }

  if (lower === 'off') {
    const error = persist({ ...current, enabled: false })
    if (error) return text(formatPersistError(error))
    return text('Smart routing disabled.')
  }

  if (lower === 'simple' || lower === 'strong') {
    if (!value) return text(`Specify an agentModels key: /smartroute ${lower} <key>.`)
    if (!agentModelKeys.includes(value)) {
      return text(
        `"${value}" is not a configured agentModels key.` +
          (agentModelKeys.length ? ` Available: ${agentModelKeys.join(', ')}.` : ' Configure agentModels first.'),
      )
    }
    const next: SmartRoutingSettings =
      lower === 'simple' ? { ...current, simpleModel: value } : { ...current, strongModel: value }
    const error = persist(next)
    if (error) return text(formatPersistError(error))
    return text(`Set ${lower} model to "${value}".${cheaperWarning(next, settings)}`)
  }

  return text(HELP)
}

const smartroute = {
  type: 'local',
  name: 'smartroute',
  description: 'Configure smart auto-routing (experimental): route simple turns to your configured simple model',
  argumentHint: '[on|off|simple <key>|strong <key>]',
  isEnabled: () => true,
  isHidden: false,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default smartroute

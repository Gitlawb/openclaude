import type { Command } from '../../commands.js'
import type { LocalCommandCall } from '../../types/command.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { readSmartRouting } from '../../services/api/smartRouting/settings.js'
import {
  clearSmartRoutingSessionDisable,
  getKnownInputCost,
  isSmartRoutingDisabledForSession,
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

/** Resolve an agentModels key to its underlying model string (for pricing). */
function roleModelString(key: string | undefined, settings: SettingsJson | null): string | undefined {
  if (!key) return undefined
  return settings?.agentModels?.[key]?.model ?? key
}

/**
 * Warn when both roles have first-party reference pricing and, by that pricing,
 * simple is not actually cheaper. The numbers are first-party list prices, not
 * the active provider's, so the warning is hedged accordingly.
 */
function cheaperWarning(s: SmartRoutingSettings, settings: SettingsJson | null): string {
  const simple = getKnownInputCost(roleModelString(s.simpleModel, settings) ?? '')
  const strong = getKnownInputCost(roleModelString(s.strongModel, settings) ?? '')
  if (simple != null && strong != null && simple >= strong) {
    return `\nHeads up: by first-party reference pricing the simple model is not cheaper than the strong model (${simple} vs ${strong} per Mtok input); your provider may bill differently. Smart routing may not save money.`
  }
  return ''
}

const call: LocalCommandCall = async (args, context) => {
  const arg = args.trim()
  const settings = context.getAppState().settings as unknown as SettingsJson
  const current: SmartRoutingSettings = { ...(settings?.smartRouting ?? {}) }
  const agentModelKeys = Object.keys(settings?.agentModels ?? {})

  const persist = (next: SmartRoutingSettings) => {
    context.setAppState(s => ({
      ...s,
      settings: { ...s.settings, smartRouting: next },
    }))
    updateSettingsForSource('userSettings', { smartRouting: next })
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
      `  simple: ${current.simpleModel ?? '(unset)'}`,
      `  strong: ${current.strongModel ?? '(unset)'}`,
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
    persist(next)
    // Re-enabling clears any session auto-disable.
    clearSmartRoutingSessionDisable(getSessionId())
    return text(`Smart routing enabled (simple=${next.simpleModel}, strong=${next.strongModel}).${cheaperWarning(next, settings)}`)
  }

  if (lower === 'off') {
    persist({ ...current, enabled: false })
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
    persist(next)
    return text(`Set ${lower} model to "${value}".${cheaperWarning(next, settings)}`)
  }

  return text(HELP)
}

const smartroute = {
  type: 'local',
  name: 'smartroute',
  description: 'Configure smart auto-routing (experimental): route simple turns to a cheaper model',
  argumentHint: '[on|off|simple <key>|strong <key>]',
  isEnabled: () => true,
  isHidden: false,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default smartroute

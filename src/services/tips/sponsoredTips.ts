import chalk from 'chalk'
import { color } from '../../components/design-system/color.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import type { Tip, TipContext, TipSponsor } from './types.js'

const DEFAULT_FREQUENCY = 10

export function sponsoredTipsEnabled(): boolean {
  const settings = getSettings_DEPRECATED()
  if (settings.sponsoredTipsEnabled === false) return false
  if (settings.sponsoredTipsFrequency === 0) return false
  return true
}

export function getSponsoredTipsFrequency(): number {
  const settings = getSettings_DEPRECATED()
  const f = settings.sponsoredTipsFrequency
  if (typeof f === 'number' && f >= 0) return f
  return DEFAULT_FREQUENCY
}

const ATOMIC: TipSponsor = {
  name: 'Atomic Chat',
  url: 'https://atomic.chat/',
}

function renderSponsoredTip(
  sponsor: TipSponsor,
  body: string,
  ctx: TipContext,
): string {
  const green = color('success', ctx.theme)
  const label = sponsor.label ?? 'Sponsored'
  const badge = green(`${label} · ${sponsor.name}`)
  const text = green(body)
  const url = sponsor.url ? ` ${chalk.dim(sponsor.url)}` : ''
  return `${badge} — ${text}${url}`
}

export const sponsoredTips: Tip[] = [
  {
    id: 'atomic-setup-local',
    sponsor: ATOMIC,
    content: async ctx =>
      renderSponsoredTip(
        ATOMIC,
        'Setup free local models with Atomic Chat',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'atomic-free-access',
    sponsor: ATOMIC,
    content: async ctx =>
      renderSponsoredTip(
        ATOMIC,
        'Atomic Chat local models give you free access to OpenClaude',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'atomic-turboquant-context',
    sponsor: ATOMIC,
    content: async ctx =>
      renderSponsoredTip(
        ATOMIC,
        'Increase your context window with TurboQuant in Atomic Chat local models',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'atomic-ram-savings',
    sponsor: ATOMIC,
    content: async ctx =>
      renderSponsoredTip(
        ATOMIC,
        '30% less RAM usage with Atomic Chat local models',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
]

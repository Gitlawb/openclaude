import { color } from '../../components/design-system/color.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { renderSponsorLink } from './tipLink.js'
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

const XIAOMI_MIMO: TipSponsor = {
  name: 'Xiaomi MiMo',
  url: 'https://api.xiaomimimo.com/v1',
}

const ATLAS_CLOUD: TipSponsor = {
  name: 'Atlas Cloud',
  url: 'https://www.atlascloud.ai/',
}

function renderSponsoredTip(
  sponsor: TipSponsor,
  body: string,
  ctx: TipContext,
): string {
  const green = color('success', ctx.theme)
  const label = sponsor.label ?? 'Sponsored'
  // Sponsor name becomes a clickable hyperlink to its URL rather than printing
  // the raw URL inline; falls back to the dimmed URL where OSC 8 is unsupported.
  const { display, trailing } = renderSponsorLink(sponsor.name, sponsor.url)
  const badge = green(`${label} · ${display}`)
  const text = green(body)
  return `${badge} — ${text}${trailing}`
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
  {
    id: 'xiaomi-mimo-context-window',
    sponsor: XIAOMI_MIMO,
    content: async ctx =>
      renderSponsoredTip(
        XIAOMI_MIMO,
        'Increase your context window with Xiaomi MiMo',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'xiaomi-mimo-coding-benchmarks',
    sponsor: XIAOMI_MIMO,
    content: async ctx =>
      renderSponsoredTip(
        XIAOMI_MIMO,
        'MiMo performs well on coding benchmarks',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'xiaomi-mimo-hugging-face-ranking',
    sponsor: XIAOMI_MIMO,
    content: async ctx =>
      renderSponsoredTip(
        XIAOMI_MIMO,
        'Hugging Face shows MiMo among top coding models',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'xiaomi-mimo-compatible-tools',
    sponsor: XIAOMI_MIMO,
    content: async ctx =>
      renderSponsoredTip(
        XIAOMI_MIMO,
        'You can switch to Xiaomi MiMo in compatible tools',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'xiaomi-mimo-real-problems',
    sponsor: XIAOMI_MIMO,
    content: async ctx =>
      renderSponsoredTip(
        XIAOMI_MIMO,
        "MiMo's true value: efficiently solving developers' real problems",
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
  {
    id: 'atlas-cloud-platform',
    sponsor: ATLAS_CLOUD,
    content: async ctx =>
      renderSponsoredTip(
        ATLAS_CLOUD,
        'Single AI API · full-modal AI inference platform · 300+ curated models',
        ctx,
      ),
    cooldownSessions: 20,
    isRelevant: async () => sponsoredTipsEnabled(),
  },
]

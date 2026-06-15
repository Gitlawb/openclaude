import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { fetchNextTip, confirmTip } from '../services/ads.js'

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function usd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(4)}`
}

function statusText(): string {
  const ads = getGlobalConfig().ads
  if (!ads?.enabled) {
    return [
      'Sponsored tips: off',
      'Enable with "/ads on <code>" to earn opengateway credits while you code.',
      'Get your code from the Earn tab at gitlawb.com/opengateway.',
    ].join('\n')
  }
  const masked = ads.earnCode ? `${ads.earnCode.slice(0, 6)}…` : '(none)'
  return [
    `Sponsored tips: on  (earn code ${masked})`,
    'You earn opengateway credits when a tip is shown during loading.',
    'Turn off any time with "/ads off".',
  ].join('\n')
}

/**
 * `/ads on <code>` — opt in and bind the Earn-tab code (then run one live tip so
 * the user immediately sees a credit land). `/ads off` — opt out. `/ads` — status.
 */
const call: LocalCommandCall = async args => {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] ?? '').toLowerCase()

  if (sub === 'off') {
    const wasOn = getGlobalConfig().ads?.enabled
    saveGlobalConfig(c => ({ ...c, ads: { ...(c.ads ?? {}), enabled: false } }))
    return {
      type: 'text',
      value: wasOn ? 'Sponsored tips disabled.' : 'Sponsored tips are already off.',
    }
  }

  if (sub === 'on') {
    const code = parts[1]
    if (!code) {
      return {
        type: 'text',
        value:
          'Usage: /ads on <code>\nGet your earn code from the Earn tab at gitlawb.com/opengateway.',
      }
    }
    saveGlobalConfig(c => ({ ...c, ads: { ...(c.ads ?? {}), enabled: true, earnCode: code } }))

    // Run one tip now so the loop is proven and the user sees a credit land.
    const tip = await fetchNextTip(code)
    if (!tip) {
      return {
        type: 'text',
        value:
          'Sponsored tips enabled. (No tip to show right now — you\'ll start earning during loading.)',
      }
    }
    await sleep(Math.min(tip.dwellMs, 8000))
    try {
      const res = await confirmTip(code, tip.token)
      if (res.status === 'confirmed') {
        const bal = res.balanceMicro !== undefined ? `  ·  balance ${usd(res.balanceMicro)}` : ''
        return {
          type: 'text',
          value: `Sponsored tips enabled — you're earning.\n\n${tip.label}: ${tip.text}\n+${usd(
            res.earnedMicro,
          )} credits${bal}`,
        }
      }
      return {
        type: 'text',
        value: `Sponsored tips enabled. (Test tip not credited: ${res.status}.)`,
      }
    } catch {
      return {
        type: 'text',
        value: 'Sponsored tips enabled. (Could not reach the ads service for the test tip.)',
      }
    }
  }

  return { type: 'text', value: statusText() }
}

const ads = {
  type: 'local',
  name: 'ads',
  description: 'Earn opengateway credits from sponsored tips (ads.gitlawb.com)',
  argumentHint: 'on <code> | off',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default ads

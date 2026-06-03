import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

export function recordTipShown(tipId: string): void {
  const numStartups = getGlobalConfig().numStartups
  saveGlobalConfig(c => {
    const history = c.tipsHistory ?? {}
    if (history[tipId] === numStartups) return c
    return { ...c, tipsHistory: { ...history, [tipId]: numStartups } }
  })
}

export function getSessionsSinceLastShown(tipId: string): number {
  const config = getGlobalConfig()
  const lastShown = config.tipsHistory?.[tipId]
  if (!lastShown) return Infinity
  return config.numStartups - lastShown
}

export function recordSponsoredTipShown(): void {
  const numStartups = getGlobalConfig().numStartups
  saveGlobalConfig(c => {
    const prev = c.sponsoredTipsHistory ?? { lastShownAt: 0, totalShown: 0 }
    return {
      ...c,
      sponsoredTipsHistory: {
        lastShownAt: numStartups,
        totalShown: prev.totalShown + 1,
      },
    }
  })
}

export function getSessionsSinceLastSponsored(): number {
  const config = getGlobalConfig()
  const lastShown = config.sponsoredTipsHistory?.lastShownAt
  if (!lastShown) return Infinity
  return config.numStartups - lastShown
}

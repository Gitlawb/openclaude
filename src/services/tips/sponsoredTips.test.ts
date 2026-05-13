import { describe, expect, mock, test } from 'bun:test'

type StubSettings = {
  sponsoredTipsEnabled?: boolean
  sponsoredTipsFrequency?: number
  spinnerTipsEnabled?: boolean
}

const settingsRef: { value: StubSettings } = { value: {} }
const configRef: {
  value: { numStartups: number; sponsoredTipsHistory?: { lastShownAt: number; totalShown: number } }
} = { value: { numStartups: 100 } }

// mock.module is process-global — install once, then mutate the refs per test.
mock.module('../../utils/settings/settings.js', () => ({
  getSettings_DEPRECATED: () => settingsRef.value,
  getInitialSettings: () => settingsRef.value,
  getSettingsForSource: () => undefined,
}))

mock.module('../../utils/config.js', () => ({
  getGlobalConfig: () => configRef.value,
  saveGlobalConfig: (mut: (c: typeof configRef.value) => typeof configRef.value) => {
    configRef.value = mut(configRef.value)
  },
}))

async function freshImport() {
  const stamp = `${Date.now()}-${Math.random()}`
  return {
    sponsoredTips: await import(`./sponsoredTips.ts?ts=${stamp}`),
    tipHistory: await import(`./tipHistory.ts?ts=${stamp}`),
  }
}

function resetState(settings: StubSettings = {}, numStartups = 100) {
  settingsRef.value = settings
  configRef.value = { numStartups }
}

describe('sponsoredTipsEnabled', () => {
  test('defaults to true when no settings present', async () => {
    resetState()
    const { sponsoredTips } = await freshImport()
    expect(sponsoredTips.sponsoredTipsEnabled()).toBe(true)
  })

  test('returns false when explicitly disabled', async () => {
    resetState({ sponsoredTipsEnabled: false })
    const { sponsoredTips } = await freshImport()
    expect(sponsoredTips.sponsoredTipsEnabled()).toBe(false)
  })

  test('returns false when frequency is 0', async () => {
    resetState({ sponsoredTipsFrequency: 0 })
    const { sponsoredTips } = await freshImport()
    expect(sponsoredTips.sponsoredTipsEnabled()).toBe(false)
  })
})

describe('getSponsoredTipsFrequency', () => {
  test('defaults to 10', async () => {
    resetState()
    const { sponsoredTips } = await freshImport()
    expect(sponsoredTips.getSponsoredTipsFrequency()).toBe(10)
  })

  test('honors user-configured frequency', async () => {
    resetState({ sponsoredTipsFrequency: 25 })
    const { sponsoredTips } = await freshImport()
    expect(sponsoredTips.getSponsoredTipsFrequency()).toBe(25)
  })

  test('rejects negative values', async () => {
    resetState({ sponsoredTipsFrequency: -5 })
    const { sponsoredTips } = await freshImport()
    expect(sponsoredTips.getSponsoredTipsFrequency()).toBe(10)
  })
})

describe('sponsored tip catalog', () => {
  test('has exactly 4 Atomic tips', async () => {
    resetState()
    const { sponsoredTips } = await freshImport()
    expect(sponsoredTips.sponsoredTips.length).toBe(4)
    expect(
      sponsoredTips.sponsoredTips.every(
        (t: { sponsor?: { name: string; url?: string } }) =>
          t.sponsor?.name === 'Atomic Chat' &&
          t.sponsor.url === 'https://atomic.chat/',
      ),
    ).toBe(true)
  })

  test('all tips have unique ids prefixed with atomic-', async () => {
    resetState()
    const { sponsoredTips } = await freshImport()
    const ids = sponsoredTips.sponsoredTips.map((t: { id: string }) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id: string) => id.startsWith('atomic-'))).toBe(true)
  })

  test('rendered content embeds sponsor name, tip body, and URL', async () => {
    resetState()
    const { sponsoredTips } = await freshImport()
    const tip = sponsoredTips.sponsoredTips[0]
    const rendered: string = await tip.content({ theme: 'dark' })
    // ANSI codes wrap the strings — assert on plain substrings
    expect(rendered).toContain('Sponsored')
    expect(rendered).toContain('Atomic Chat')
    expect(rendered).toContain('Setup free local models')
    expect(rendered).toContain('https://atomic.chat/')
  })

  test('isRelevant follows sponsoredTipsEnabled', async () => {
    resetState({ sponsoredTipsEnabled: false })
    const { sponsoredTips } = await freshImport()
    const results = await Promise.all(
      sponsoredTips.sponsoredTips.map((t: { isRelevant: () => Promise<boolean> }) =>
        t.isRelevant(),
      ),
    )
    expect(results.every((r: boolean) => r === false)).toBe(true)
  })
})

describe('sponsored history tracking', () => {
  test('records lastShownAt and increments totalShown', async () => {
    resetState({}, 50)
    const { tipHistory } = await freshImport()
    tipHistory.recordSponsoredTipShown()
    expect(configRef.value.sponsoredTipsHistory).toEqual({
      lastShownAt: 50,
      totalShown: 1,
    })
    tipHistory.recordSponsoredTipShown()
    expect(configRef.value.sponsoredTipsHistory).toEqual({
      lastShownAt: 50,
      totalShown: 2,
    })
  })

  test('getSessionsSinceLastSponsored returns Infinity when never shown', async () => {
    resetState({}, 100)
    const { tipHistory } = await freshImport()
    expect(tipHistory.getSessionsSinceLastSponsored()).toBe(Infinity)
  })

  test('getSessionsSinceLastSponsored returns delta from current startups', async () => {
    resetState({}, 100)
    configRef.value.sponsoredTipsHistory = { lastShownAt: 92, totalShown: 3 }
    const { tipHistory } = await freshImport()
    expect(tipHistory.getSessionsSinceLastSponsored()).toBe(8)
  })
})

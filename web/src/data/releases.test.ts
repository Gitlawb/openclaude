import { describe, expect, test } from 'bun:test'

import { latestVersion, releases } from './releases'
import { SITE } from './site'

describe('releases.ts 0.27.0 changelog entry', () => {
  test('0.27.0 is the newest entry and drives SITE.version / latestVersion', () => {
    expect(releases[0]?.version).toBe('0.27.0')
    expect(latestVersion).toBe('0.27.0')
    expect(SITE.version).toBe('0.27.0')
  })

  test('0.27.0 has date, theme, and non-empty highlights', () => {
    const r = releases.find(entry => entry.version === '0.27.0')
    expect(r).toBeDefined()
    expect(r!.date).toBe('2026-07-30')
    expect(r!.theme.length).toBeGreaterThan(0)
    expect(r!.highlights.length).toBeGreaterThan(0)
    expect(
      r!.highlights.every(h => typeof h === 'string' && h.length > 0),
    ).toBe(true)
  })

  test('releases stay newest-first by version order of appearance', () => {
    expect(releases.map(r => r.version).slice(0, 2)).toEqual([
      '0.27.0',
      '0.26.0',
    ])
  })
})

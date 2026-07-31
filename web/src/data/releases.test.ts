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
    const versions = releases.map(r => r.version)
    expect(versions[0]).toBe('0.27.0')
    expect(versions).toEqual([
      '0.27.0',
      '0.26.0',
      '0.25.0',
      '0.24.0',
      '0.23.0',
      '0.22.0',
      '0.21.0',
      '0.20.0',
      '0.19.0',
    ])

    // Adjacent semver check so a mid-list reorder fails even if the
    // hard-coded sequence above is updated carelessly later.
    for (let i = 0; i < versions.length - 1; i++) {
      expect(compareSemver(versions[i]!, versions[i + 1]!)).toBeGreaterThan(0)
    }
  })
})

/** Compare dotted numeric semver (X.Y.Z…). Returns >0 if a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => Number.parseInt(n, 10))
  const pb = b.split('.').map(n => Number.parseInt(n, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (Number.isNaN(da) || Number.isNaN(db)) {
      throw new Error(`non-numeric semver segment: ${a} vs ${b}`)
    }
    if (da !== db) return da - db
  }
  return 0
}

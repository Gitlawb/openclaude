import { describe, expect, test } from 'bun:test'

describe('DuckDuckGo SafeSearchType', () => {
  test('SafeSearchType.STRICT === 0 (matches previous raw value)', async () => {
    const { SafeSearchType } = await import('duck-duck-scrape')
    expect(SafeSearchType.STRICT).toBe(0)
  })

  test('SafeSearchType enum values are sane', async () => {
    const { SafeSearchType } = await import('duck-duck-scrape')
    expect(SafeSearchType.STRICT).toBe(0)
    expect(SafeSearchType.MODERATE).toBe(-1)
    expect(SafeSearchType.OFF).toBe(-2)
  })
})

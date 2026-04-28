import { describe, expect, it, beforeEach } from 'bun:test'
import { InMemoryTokenCache } from './crossSessionTokenCache.js'

describe('InMemoryTokenCache', () => {
  let cache: InMemoryTokenCache

  beforeEach(() => {
    cache = new InMemoryTokenCache(10, 1000)
  })

  it('caches content and returns token count', () => {
    const count = cache.getTokenCount('Hello world, this is a test message.')
    expect(count).toBeGreaterThan(0)
  })

  it('detects cached content', () => {
    const content = 'Same content here'
    cache.getTokenCount(content)
    expect(cache.has(content)).toBe(true)
  })

  it('tracks use count for reused content', () => {
    const content = 'Reused content'
    cache.getTokenCount(content)
    cache.getTokenCount(content)
    cache.getTokenCount(content)

    const result = cache.estimateWithBounds(content)
    expect(result.cached).toBe(true)
  })

  it('prunes old entries', async () => {
    cache.getTokenCount('Content 1')
    cache.getTokenCount('Content 2')
    cache.getTokenCount('Content 3')

    // Wait for expiry
    await new Promise(r => setTimeout(r, 1100))
    cache.prune()

    // Re-add to trigger prune
    cache.getTokenCount('Content 4')
    cache.getTokenCount('Content 5')
    cache.getTokenCount('Content 6')
    cache.getTokenCount('Content 7')
    cache.getTokenCount('Content 8')
    cache.getTokenCount('Content 9')
    cache.getTokenCount('Content 10')
    cache.getTokenCount('Content 11')
    cache.getTokenCount('Content 12')

    // Cache should be smaller due to maxEntries
    expect(cache.getStats().size).toBeLessThanOrEqual(10)
  })

  it('returns bounds around estimate', () => {
    const content = 'Bounds test content here'
    const result = cache.estimateWithBounds(content)

    expect(result.lowerBound).toBeLessThanOrEqual(result.estimate)
    expect(result.upperBound).toBeGreaterThanOrEqual(result.estimate)
    expect(result.lowerBound).toBeLessThan(result.upperBound)
    expect(['high', 'medium', 'low']).toContain(result.confidence)
  })

  it('confidence increases with reuse count', () => {
    const content = 'Confidence test content'

    const result1 = cache.estimateWithBounds(content)
    expect(result1.confidence).toBe('low')

    const result2 = cache.estimateWithBounds(content)
    expect(result2.confidence).toBe('medium')

    const result3 = cache.estimateWithBounds(content)
    expect(result3.confidence).toBe('high')
  })

  it('higher confidence gives tighter bounds', () => {
    const content = 'Tight bounds test'
    cache.getTokenCount(content)
    cache.getTokenCount(content)
    cache.getTokenCount(content)

    const result = cache.estimateWithBounds(content)
    const spread = result.upperBound - result.lowerBound
    const estimate = result.estimate

    expect(spread / estimate).toBeLessThan(0.15)
  })

  it('tracks reuse statistics', () => {
    const content = 'Statistical test'
    cache.getTokenCount(content)
    cache.getTokenCount(content)

    const stats = cache.getStats()
    expect(stats.totalUses).toBeGreaterThan(0)
  })

  it('clears all entries', () => {
    cache.getTokenCount('Test 1')
    cache.getTokenCount('Test 2')
    cache.clear()

    expect(cache.getStats().size).toBe(0)
  })
})
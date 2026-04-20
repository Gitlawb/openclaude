import { describe, expect, it, beforeEach } from 'bun:test'
import { CrossSessionTokenCache } from './tokens.js'

describe('CrossSessionTokenCache', () => {
  let cache: CrossSessionTokenCache

  beforeEach(() => {
    cache = new CrossSessionTokenCache(10, 1000)
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

    expect(result.min).toBeLessThanOrEqual(result.estimate)
    expect(result.max).toBeGreaterThanOrEqual(result.estimate)
    expect(result.min).toBeLessThan(result.max)
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
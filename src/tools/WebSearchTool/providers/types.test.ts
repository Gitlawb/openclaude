import { describe, expect, test } from 'bun:test'
import { applyDomainFilters, normalizeHit, safeHostname } from './types.js'

// ---------------------------------------------------------------------------
// safeHostname
// ---------------------------------------------------------------------------

describe('safeHostname', () => {
  test('returns hostname for valid URL', () => {
    expect(safeHostname('https://example.com/path')).toBe('example.com')
  })

  test('returns hostname with subdomain', () => {
    expect(safeHostname('https://api.example.com/v1')).toBe('api.example.com')
  })

  test('returns undefined for invalid URL', () => {
    expect(safeHostname('not-a-url')).toBeUndefined()
  })

  test('returns undefined for empty string', () => {
    expect(safeHostname('')).toBeUndefined()
  })

  test('returns undefined for undefined', () => {
    expect(safeHostname(undefined)).toBeUndefined()
  })

  test('returns undefined for relative path', () => {
    expect(safeHostname('/path/only')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// normalizeHit
// ---------------------------------------------------------------------------

describe('normalizeHit', () => {
  test('extracts standard fields', () => {
    const hit = normalizeHit({ title: 'Test', url: 'https://example.com' })
    expect(hit).toEqual({ title: 'Test', url: 'https://example.com' })
  })

  test('extracts alternative field names (headline, link, snippet)', () => {
    const hit = normalizeHit({
      headline: 'Test',
      link: 'https://ex.com',
      snippet: 'desc',
    })
    expect(hit?.title).toBe('Test')
    expect(hit?.url).toBe('https://ex.com')
    expect(hit?.description).toBe('desc')
  })

  test('extracts source from various keys', () => {
    const hit = normalizeHit({
      title: 'T',
      url: 'https://example.com',
      displayLink: 'example.com',
    })
    expect(hit?.source).toBe('example.com')
  })

  test('returns null for empty object', () => {
    expect(normalizeHit({})).toBeNull()
  })

  test('returns null for null input', () => {
    expect(normalizeHit(null)).toBeNull()
  })

  test('returns null for non-object input', () => {
    expect(normalizeHit('string')).toBeNull()
    expect(normalizeHit(42)).toBeNull()
  })

  test('uses url as title when title missing', () => {
    const hit = normalizeHit({ url: 'https://example.com' })
    expect(hit?.title).toBe('https://example.com')
    expect(hit?.url).toBe('https://example.com')
  })
})

// ---------------------------------------------------------------------------
// applyDomainFilters
// ---------------------------------------------------------------------------

describe('applyDomainFilters', () => {
  test('filters blocked domains', () => {
    const hits = [
      { title: 'good', url: 'https://example.com/page' },
      { title: 'bad', url: 'https://badsite.com/page' },
    ]
    const result = applyDomainFilters(hits, {
      query: 'test',
      blocked_domains: ['badsite.com'],
    })
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/page')
  })

  test('keeps malformed URLs when filtering blocked (security)', () => {
    const hits = [{ title: 'weird', url: 'not-a-valid-url' }]
    const result = applyDomainFilters(hits, {
      query: 'test',
      blocked_domains: ['example.com'],
    })
    // Can't confirm it's blocked → keep it
    expect(result).toHaveLength(1)
  })

  test('filters allowed domains only', () => {
    const hits = [
      { title: 'good', url: 'https://example.com/page' },
      { title: 'bad', url: 'https://other.com/page' },
    ]
    const result = applyDomainFilters(hits, {
      query: 'test',
      allowed_domains: ['example.com'],
    })
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/page')
  })

  test('drops malformed URLs when filtering allowed (security)', () => {
    const hits = [{ title: 'weird', url: 'not-a-valid-url' }]
    const result = applyDomainFilters(hits, {
      query: 'test',
      allowed_domains: ['example.com'],
    })
    // Can't confirm it's allowed → drop it
    expect(result).toHaveLength(0)
  })

  test('handles subdomain matching', () => {
    const hits = [{ title: 't', url: 'https://sub.example.com/page' }]
    const blocked = applyDomainFilters(hits, {
      query: 'test',
      blocked_domains: ['example.com'],
    })
    expect(blocked).toHaveLength(0)

    const allowed = applyDomainFilters(hits, {
      query: 'test',
      allowed_domains: ['example.com'],
    })
    expect(allowed).toHaveLength(1)
  })

  test('returns all hits when no domain filters', () => {
    const hits = [
      { title: 'a', url: 'https://a.com' },
      { title: 'b', url: 'https://b.com' },
    ]
    const result = applyDomainFilters(hits, { query: 'test' })
    expect(result).toHaveLength(2)
  })

  test('combines blocked and allowed filters', () => {
    const hits = [
      { title: 'good', url: 'https://example.com/page' },
      { title: 'blocked', url: 'https://badsite.com/page' },
      { title: 'other', url: 'https://other.com/page' },
    ]
    const result = applyDomainFilters(hits, {
      query: 'test',
      blocked_domains: ['badsite.com'],
      allowed_domains: ['example.com'],
    })
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/page')
  })
})

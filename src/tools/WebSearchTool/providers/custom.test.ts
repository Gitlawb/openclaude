import { describe, expect, test } from 'bun:test'
import { extractHits } from './custom.js'

// ---------------------------------------------------------------------------
// extractHits — flexible response parsing
// ---------------------------------------------------------------------------

describe('extractHits', () => {
  test('extracts from results array', () => {
    const data = { results: [{ title: 'T', url: 'https://ex.com' }] }
    const hits = extractHits(data)
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('T')
  })

  test('extracts from items array (Google-style)', () => {
    const data = { items: [{ title: 'T', link: 'https://ex.com' }] }
    const hits = extractHits(data)
    expect(hits).toHaveLength(1)
    expect(hits[0].url).toBe('https://ex.com')
  })

  test('extracts from data array', () => {
    const data = { data: [{ title: 'T', url: 'https://ex.com' }] }
    const hits = extractHits(data)
    expect(hits).toHaveLength(1)
  })

  test('extracts from bare array', () => {
    const data = [{ title: 'T', url: 'https://ex.com' }]
    const hits = extractHits(data)
    expect(hits).toHaveLength(1)
  })

  test('extracts from nested map (e.g. web.results)', () => {
    const data = {
      web: {
        results: [{ title: 'T', url: 'https://ex.com' }],
      },
    }
    const hits = extractHits(data)
    expect(hits).toHaveLength(1)
  })

  test('extracts with explicit jsonPath', () => {
    const data = {
      response: {
        payload: [{ title: 'T', url: 'https://ex.com' }],
      },
    }
    const hits = extractHits(data, 'response.payload')
    expect(hits).toHaveLength(1)
  })

  test('returns empty for empty object', () => {
    expect(extractHits({})).toHaveLength(0)
  })

  test('returns empty for null', () => {
    expect(extractHits(null)).toHaveLength(0)
  })

  test('returns empty for no array keys', () => {
    expect(extractHits({ status: 'ok', count: 5 })).toHaveLength(0)
  })

  test('filters out hits with no title and no url', () => {
    const data = {
      results: [
        { title: 'Valid', url: 'https://ex.com' },
        { description: 'no title or url' },
      ],
    }
    const hits = extractHits(data)
    expect(hits).toHaveLength(1)
  })

  test('extracts from organic_results (SerpAPI-style)', () => {
    const data = {
      organic_results: [{ title: 'T', link: 'https://ex.com' }],
    }
    const hits = extractHits(data)
    expect(hits).toHaveLength(1)
  })
})

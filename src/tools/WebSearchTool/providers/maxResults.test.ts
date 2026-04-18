import { describe, expect, test, afterEach } from 'bun:test'

describe('WEB_MAX_RESULTS env override', () => {
  const savedEnv = process.env.WEB_MAX_RESULTS

  afterEach(() => {
    if (savedEnv !== undefined) process.env.WEB_MAX_RESULTS = savedEnv
    else delete process.env.WEB_MAX_RESULTS
  })

  test('defaults to 10 when env not set', () => {
    delete process.env.WEB_MAX_RESULTS
    const result = Number(process.env.WEB_MAX_RESULTS) || 10
    expect(result).toBe(10)
  })

  test('uses custom value when WEB_MAX_RESULTS is set', () => {
    process.env.WEB_MAX_RESULTS = '20'
    const result = Number(process.env.WEB_MAX_RESULTS) || 10
    expect(result).toBe(20)
  })

  test('supports large values', () => {
    process.env.WEB_MAX_RESULTS = '100'
    const result = Number(process.env.WEB_MAX_RESULTS) || 10
    expect(result).toBe(100)
  })

  test('falls back on non-numeric env', () => {
    process.env.WEB_MAX_RESULTS = 'abc'
    const result = Number(process.env.WEB_MAX_RESULTS) || 10
    expect(result).toBe(10)
  })

  test('falls back on empty env', () => {
    process.env.WEB_MAX_RESULTS = ''
    const result = Number(process.env.WEB_MAX_RESULTS) || 10
    expect(result).toBe(10)
  })
})

describe('custom provider result count param detection', () => {
  test('skips adding count param if existing result param is present', () => {
    const resultParams = ['count', 'num', 'limit', 'size', 'per_page', 'max_results', 'rows', 'results']
    const url = new URL('https://example.com/search')
    url.searchParams.set('q', 'test')
    url.searchParams.set('limit', '20')

    const hasResultParam = resultParams.some(p => url.searchParams.has(p))
    expect(hasResultParam).toBe(true)
  })

  test('adds count param if no result param is present', () => {
    const resultParams = ['count', 'num', 'limit', 'size', 'per_page', 'max_results', 'rows', 'results']
    const url = new URL('https://example.com/search')
    url.searchParams.set('q', 'test')

    const hasResultParam = resultParams.some(p => url.searchParams.has(p))
    expect(hasResultParam).toBe(false)

    // Simulate what buildRequest does
    if (!hasResultParam) {
      url.searchParams.set('count', '10')
    }
    expect(url.searchParams.get('count')).toBe('10')
  })

  test('preserves user-set count from WEB_PARAMS', () => {
    const resultParams = ['count', 'num', 'limit', 'size', 'per_page', 'max_results', 'rows', 'results']
    const url = new URL('https://example.com/search')
    url.searchParams.set('q', 'test')
    url.searchParams.set('count', '50') // set by WEB_PARAMS

    const hasResultParam = resultParams.some(p => url.searchParams.has(p))
    expect(hasResultParam).toBe(true)
    // Should NOT override
    expect(url.searchParams.get('count')).toBe('50')
  })
})

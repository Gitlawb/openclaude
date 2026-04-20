import { describe, expect, test } from 'bun:test'

import {
  createCredentialPool,
  parseKeyList,
} from './credentialPool.ts'

describe('parseKeyList', () => {
  test('returns empty for nullish input', () => {
    expect(parseKeyList(undefined)).toEqual([])
    expect(parseKeyList(null)).toEqual([])
    expect(parseKeyList('')).toEqual([])
  })

  test('splits on commas and trims whitespace', () => {
    expect(parseKeyList('sk-1, sk-2 ,sk-3')).toEqual(['sk-1', 'sk-2', 'sk-3'])
  })

  test('drops empty entries', () => {
    expect(parseKeyList('sk-1,,sk-2, ,sk-3')).toEqual(['sk-1', 'sk-2', 'sk-3'])
  })

  test('dedupes while preserving order', () => {
    expect(parseKeyList('sk-1,sk-2,sk-1,sk-3,sk-2')).toEqual([
      'sk-1',
      'sk-2',
      'sk-3',
    ])
  })

  test('handles a single key with no commas', () => {
    expect(parseKeyList('sk-only')).toEqual(['sk-only'])
  })
})

describe('createCredentialPool', () => {
  test('round-robins through healthy keys', () => {
    const pool = createCredentialPool(['a', 'b', 'c'])
    expect(pool.next()?.token).toBe('a')
    expect(pool.next()?.token).toBe('b')
    expect(pool.next()?.token).toBe('c')
    expect(pool.next()?.token).toBe('a')
  })

  test('reports size and healthy count', () => {
    const pool = createCredentialPool(['a', 'b', 'c'])
    expect(pool.size).toBe(3)
    expect(pool.healthyCount()).toBe(3)
  })

  test('empty pool returns null from next()', () => {
    const pool = createCredentialPool([])
    expect(pool.next()).toBeNull()
    expect(pool.size).toBe(0)
    expect(pool.healthyCount()).toBe(0)
  })

  test('single-key pool repeats that key', () => {
    const pool = createCredentialPool(['only'])
    expect(pool.next()?.token).toBe('only')
    expect(pool.next()?.token).toBe('only')
  })

  test('attempt includes the original index', () => {
    const pool = createCredentialPool(['a', 'b', 'c'])
    expect(pool.next()).toEqual({ token: 'a', index: 0 })
    expect(pool.next()).toEqual({ token: 'b', index: 1 })
    expect(pool.next()).toEqual({ token: 'c', index: 2 })
  })

  test('auth failure evicts a key permanently', () => {
    const pool = createCredentialPool(['a', 'b', 'c'])
    pool.markFailed('b', 'auth')
    expect(pool.healthyCount()).toBe(2)

    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const attempt = pool.next()
      if (attempt) seen.add(attempt.token)
    }
    expect(seen.has('a')).toBe(true)
    expect(seen.has('c')).toBe(true)
    // 'b' may return only as a degraded last-resort; with other keys healthy, never.
    expect(seen.has('b')).toBe(false)
  })

  test('rate-limit failure puts a key in cooldown', () => {
    const pool = createCredentialPool(['a', 'b'])
    pool.markFailed('a', 'rate_limit')
    expect(pool.healthyCount()).toBe(1)
    // 'a' is cooling; next() should return 'b' repeatedly while 'a' is cold.
    expect(pool.next()?.token).toBe('b')
    expect(pool.next()?.token).toBe('b')
  })

  test('markSuccess clears cooldown', () => {
    const pool = createCredentialPool(['a', 'b'])
    pool.markFailed('a', 'rate_limit')
    expect(pool.healthyCount()).toBe(1)
    pool.markSuccess('a')
    expect(pool.healthyCount()).toBe(2)
  })

  test('markFailed on unknown token is a no-op', () => {
    const pool = createCredentialPool(['a', 'b'])
    pool.markFailed('does-not-exist', 'auth')
    expect(pool.healthyCount()).toBe(2)
  })

  test('all-evicted pool still returns a degraded attempt', () => {
    const pool = createCredentialPool(['a', 'b'])
    pool.markFailed('a', 'auth')
    pool.markFailed('b', 'auth')
    expect(pool.healthyCount()).toBe(0)
    // Degrades to least-recently-failed key so caller still has an attempt
    // to make (which will fail and surface a real error to the user).
    const attempt = pool.next()
    expect(attempt).not.toBeNull()
    expect(['a', 'b']).toContain(attempt?.token)
  })

  test('all-cooling pool returns least-recently-failed key', () => {
    const pool = createCredentialPool(['a', 'b'])
    pool.markFailed('a', 'rate_limit')
    // Small delay to ensure 'a' is older than 'b'
    const then = Date.now()
    while (Date.now() === then) {
      // spin for at least 1ms so lastFailureAtMs differs
    }
    pool.markFailed('b', 'rate_limit')
    expect(pool.healthyCount()).toBe(0)
    // Degraded pick = least-recently-failed = 'a'
    expect(pool.next()?.token).toBe('a')
  })
})

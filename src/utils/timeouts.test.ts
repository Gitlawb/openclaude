import { describe, expect, test } from 'bun:test'
import { DEFAULT_QUERY_HARD_MAX_MS } from './QueryGuard.js'
import {
  getDefaultBashTimeoutMs,
  getEffectiveBashTimeoutMs,
  getMaxBashTimeoutMs,
} from './timeouts.js'

describe('bash timeout helpers', () => {
  test('effective timeout clamps explicit values to the configured max', () => {
    const env = {
      BASH_DEFAULT_TIMEOUT_MS: '120000',
      BASH_MAX_TIMEOUT_MS: '300000',
    }

    expect(getEffectiveBashTimeoutMs(900_000, env)).toBe(300_000)
  })

  test('configured defaults and max values cannot exceed the query hard cap', () => {
    const env = {
      BASH_DEFAULT_TIMEOUT_MS: String(DEFAULT_QUERY_HARD_MAX_MS * 2),
      BASH_MAX_TIMEOUT_MS: String(DEFAULT_QUERY_HARD_MAX_MS * 3),
    }

    expect(getDefaultBashTimeoutMs(env)).toBe(DEFAULT_QUERY_HARD_MAX_MS)
    expect(getMaxBashTimeoutMs(env)).toBe(DEFAULT_QUERY_HARD_MAX_MS)
    expect(getEffectiveBashTimeoutMs(DEFAULT_QUERY_HARD_MAX_MS * 4, env)).toBe(
      DEFAULT_QUERY_HARD_MAX_MS,
    )
    expect(getEffectiveBashTimeoutMs(undefined, env)).toBe(
      DEFAULT_QUERY_HARD_MAX_MS,
    )
  })

  test('effective timeout uses the configured default for invalid explicit values', () => {
    const env = {
      BASH_DEFAULT_TIMEOUT_MS: '150000',
      BASH_MAX_TIMEOUT_MS: '600000',
    }

    expect(getEffectiveBashTimeoutMs(300_000, env)).toBe(300_000)
    expect(getEffectiveBashTimeoutMs(0, env)).toBe(150_000)
    expect(getEffectiveBashTimeoutMs(-100, env)).toBe(150_000)
    expect(getEffectiveBashTimeoutMs(Number.NaN, env)).toBe(150_000)
    expect(getEffectiveBashTimeoutMs(Number.POSITIVE_INFINITY, env)).toBe(150_000)
    expect(getEffectiveBashTimeoutMs(Number.NEGATIVE_INFINITY, env)).toBe(150_000)
    expect(getEffectiveBashTimeoutMs(null, env)).toBe(150_000)
    expect(getEffectiveBashTimeoutMs(undefined, env)).toBe(150_000)
    expect(getEffectiveBashTimeoutMs('60000', env)).toBe(150_000)
  })
})

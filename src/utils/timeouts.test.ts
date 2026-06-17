import { describe, expect, test } from 'bun:test'
import { getEffectiveBashTimeoutMs } from './timeouts.js'

describe('bash timeout helpers', () => {
  test('effective timeout clamps explicit values to the configured max', () => {
    const env = {
      BASH_DEFAULT_TIMEOUT_MS: '120000',
      BASH_MAX_TIMEOUT_MS: '300000',
    }

    expect(getEffectiveBashTimeoutMs(900_000, env)).toBe(300_000)
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

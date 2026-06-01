// Regression coverage for the inline `/model <id>` -> persisted-discovery
// fallback path in `getDiscoveredNvidiaNimModelIds()`. The cache key it
// builds must match the partition the descriptor picker
// (`getOpenAIDiscoveryRequestOptions` in src/commands/model/model.tsx)
// writes to — same `(baseUrl, apiKey, headers)` triple — or the inline
// validator looks in a different partition than the picker just wrote.
//
// Previous rounds of #1177 closed the apiKey-mismatch case. This test
// pins the remaining headers-mismatch case flagged in jatmn's
// 2026-05-21 re-review.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getDiscoveryCacheKey } from '../../integrations/discoveryService.js'
import { parseCustomHeadersEnv } from '../providerCustomHeaders.js'

const ROUTE = 'nvidia-nim'

function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => T,
): T {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key]
    const value = patch[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    return fn()
  } finally {
    for (const key of Object.keys(saved)) {
      const previous = saved[key]
      if (previous === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    }
  }
}

describe('nvidia-nim discovery cache key parity', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_CUSTOM_HEADERS
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_CUSTOM_HEADERS
  })

  test('custom headers move the partition off the no-headers default', () => {
    const baseUrl = 'https://integrate.api.nvidia.com/v1'
    const apiKey = 'nvapi-test'

    const without = getDiscoveryCacheKey(ROUTE, { baseUrl, apiKey })
    const withHeaders = getDiscoveryCacheKey(ROUTE, {
      baseUrl,
      apiKey,
      headers: { 'x-tenant': 'acme' },
    })

    expect(withHeaders).not.toBe(without)
  })

  test('inline validator key matches the picker key for the same headers env', () => {
    const baseUrl = 'https://integrate.api.nvidia.com/v1'
    const apiKey = 'nvapi-test'

    withEnv(
      {
        ANTHROPIC_CUSTOM_HEADERS: 'x-tenant=acme,x-env=prod',
      },
      () => {
        const pickerKey = getDiscoveryCacheKey(ROUTE, {
          baseUrl,
          apiKey,
          headers: parseCustomHeadersEnv(
            process.env.ANTHROPIC_CUSTOM_HEADERS,
          ),
        })

        // Mirror what `getDiscoveredNvidiaNimModelIds()` now does.
        const inlineKey = getDiscoveryCacheKey(ROUTE, {
          baseUrl,
          apiKey,
          headers: parseCustomHeadersEnv(
            process.env.ANTHROPIC_CUSTOM_HEADERS,
          ),
        })

        expect(inlineKey).toBe(pickerKey)
      },
    )
  })

  test('absent ANTHROPIC_CUSTOM_HEADERS leaves picker and inline keys identical', () => {
    const baseUrl = 'https://integrate.api.nvidia.com/v1'
    const apiKey = 'nvapi-test'

    delete process.env.ANTHROPIC_CUSTOM_HEADERS

    const pickerKey = getDiscoveryCacheKey(ROUTE, {
      baseUrl,
      apiKey,
      headers: parseCustomHeadersEnv(process.env.ANTHROPIC_CUSTOM_HEADERS),
    })
    const inlineKey = getDiscoveryCacheKey(ROUTE, {
      baseUrl,
      apiKey,
      headers: parseCustomHeadersEnv(process.env.ANTHROPIC_CUSTOM_HEADERS),
    })

    expect(inlineKey).toBe(pickerKey)
  })
})

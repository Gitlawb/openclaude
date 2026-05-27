import { afterEach, describe, expect, mock, test } from 'bun:test'

// MACRO is normally substituted at build time. The test runs without the
// bundler, so stub the build-time globals before importing the module under
// test (which transitively imports utils/http.ts -> MACRO.VERSION).
;(globalThis as unknown as { MACRO?: unknown }).MACRO ??= {
  VERSION: '0.0.0-test',
  DISPLAY_VERSION: '0.0.0-test',
  BUILD_TIME: 'test',
  ISSUES_EXPLAINER: '',
  PACKAGE_URL: '',
  NATIVE_PACKAGE_URL: undefined,
}

describe('checkEndpoints (preflight)', () => {
  afterEach(() => {
    mock.restore()
  })

  test('passes a bounded timeout to axios so a hung probe cannot freeze onboarding (#1017)', async () => {
    const calls: Array<{ url: string; options: { timeout?: number } }> = []
    mock.module('axios', () => ({
      default: {
        get: async (
          url: string,
          options: { timeout?: number } = {},
        ): Promise<{ status: number }> => {
          calls.push({ url, options })
          return { status: 200 }
        },
        isAxiosError: () => false,
      },
    }))

    const { checkEndpoints, PREFLIGHT_REQUEST_TIMEOUT_MS } = await import(
      './preflightChecks.js'
    )

    const result = await checkEndpoints()

    expect(result.success).toBe(true)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.options.timeout).toBe(PREFLIGHT_REQUEST_TIMEOUT_MS)
    }
    expect(PREFLIGHT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0)
    expect(PREFLIGHT_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
  })

  test('returns a failure result (instead of throwing or hanging) when axios rejects with ECONNABORTED', async () => {
    mock.module('axios', () => ({
      default: {
        get: async (): Promise<never> => {
          const err = new Error('timeout of 5000ms exceeded') as Error & {
            code?: string
          }
          err.code = 'ECONNABORTED'
          throw err
        },
        isAxiosError: () => false,
      },
    }))

    const { checkEndpoints } = await import('./preflightChecks.js')

    const result = await checkEndpoints()

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Failed to connect to')
  })

  test('returns success when all probes return 200', async () => {
    mock.module('axios', () => ({
      default: {
        get: async (): Promise<{ status: number }> => ({ status: 200 }),
        isAxiosError: () => false,
      },
    }))

    const { checkEndpoints } = await import('./preflightChecks.js')

    const result = await checkEndpoints()
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })
})

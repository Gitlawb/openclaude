import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  buildClinePassUsageRows,
  fetchClinePassUsage,
  normalizeClinePassUsagePayload,
} from './clinepassUsage.js'
import { getClinePassUsageUrl } from './clinepassUsage/fetch.js'

describe('normalizeClinePassUsagePayload', () => {
  test('normalizes usage limits from captured response shape', () => {
    const normalized = normalizeClinePassUsagePayload({
      data: {
        limits: [
          { type: 'five_hour', percentUsed: 86, resetsAt: '2026-06-29T22:00:00.000Z' },
          { type: 'weekly', percentUsed: 34, resetsAt: '2026-07-07T00:00:00.000Z' },
          { type: 'monthly', percentUsed: 17, resetsAt: '2026-07-29T00:00:00.000Z' },
        ],
      },
    })

    expect(normalized).toEqual({
      availability: 'available',
      planName: undefined,
      windows: [
        { label: '5-Hour Limit', type: 'five_hour', usedPercent: 86, resetsAt: '2026-06-29T22:00:00.000Z' },
        { label: 'Weekly Limit', type: 'weekly', usedPercent: 34, resetsAt: '2026-07-07T00:00:00.000Z' },
        { label: 'Monthly Limit', type: 'monthly', usedPercent: 17, resetsAt: '2026-07-29T00:00:00.000Z' },
      ],
    })
  })

  test('clamps percent values to [0, 100]', () => {
    const normalized = normalizeClinePassUsagePayload({
      data: {
        limits: [
          { type: 'five_hour', percentUsed: -5, resetsAt: '2026-06-29T22:00:00.000Z' },
          { type: 'weekly', percentUsed: 150, resetsAt: '2026-07-07T00:00:00.000Z' },
        ],
      },
    })

    expect(normalized).toEqual({
      availability: 'available',
      planName: undefined,
      windows: [
        { label: '5-Hour Limit', type: 'five_hour', usedPercent: 0, resetsAt: '2026-06-29T22:00:00.000Z' },
        { label: 'Weekly Limit', type: 'weekly', usedPercent: 100, resetsAt: '2026-07-07T00:00:00.000Z' },
      ],
    })
  })

  test('rounds fractional percent values', () => {
    const normalized = normalizeClinePassUsagePayload({
      data: {
        limits: [{ type: 'five_hour', percentUsed: 86.7, resetsAt: '2026-06-29T22:00:00.000Z' }],
      },
    })

    expect(normalized).toMatchObject({
      availability: 'available',
      windows: [{ label: '5-Hour Limit', usedPercent: 87 }],
    })
  })

  test('returns unknown availability when no limits are present', () => {
    const normalized = normalizeClinePassUsagePayload({
      data: { limits: [] },
    })

    expect(normalized).toMatchObject({
      availability: 'unknown',
      windows: [],
    })
  })

  test('returns unknown availability for non-record payload', () => {
    const normalized = normalizeClinePassUsagePayload(null)

    expect(normalized).toMatchObject({
      availability: 'unknown',
      windows: [],
    })
  })

  test('drops invalid resetsAt values instead of echoing them', () => {
    const normalized = normalizeClinePassUsagePayload({
      data: {
        limits: [{ type: 'five_hour', percentUsed: 10, resetsAt: 'not-a-date' }],
      },
    })

    expect(normalized).toMatchObject({
      availability: 'available',
      windows: [{ label: '5-Hour Limit', usedPercent: 10, resetsAt: undefined }],
    })
  })
})

describe('buildClinePassUsageRows', () => {
  test('builds window rows from normalized windows', () => {
    const rows = buildClinePassUsageRows([
      { label: '5-Hour Limit', type: 'five_hour', usedPercent: 86, resetsAt: '2026-06-29T22:00:00.000Z' },
      { label: 'Weekly Limit', type: 'weekly', usedPercent: 34 },
    ])

    expect(rows).toEqual([
      { kind: 'window', label: '5-Hour Limit', usedPercent: 86, resetsAt: '2026-06-29T22:00:00.000Z' },
      { kind: 'window', label: 'Weekly Limit', usedPercent: 34 },
    ])
  })
})

describe('ClinePass usage helpers', () => {
  test('getClinePassUsageUrl returns the canonical usage endpoint', () => {
    expect(getClinePassUsageUrl()).toBe('https://api.cline.bot/api/v1/users/me/plan/usage-limits')
  })
})

describe('fetchClinePassUsage', () => {
  const originalEnv = { ...process.env }
  let originalFetch: typeof globalThis.fetch
  const originalMacro = (globalThis as unknown as Record<string, unknown>).MACRO

  beforeEach(() => {
    process.env.CLINE_API_KEY = 'cp-test-key'
    originalFetch = globalThis.fetch
    ;(globalThis as unknown as Record<string, unknown>).MACRO = { VERSION: 'test' }
  })

  afterEach(() => {
    mock.restore()
    globalThis.fetch = originalFetch
    ;(globalThis as unknown as Record<string, unknown>).MACRO = originalMacro
    process.env = { ...originalEnv }
  })

  test('throws when CLINE_API_KEY is missing', async () => {
    delete process.env.CLINE_API_KEY
    await expect(fetchClinePassUsage()).rejects.toThrow(
      'ClinePass auth is required. Set CLINE_API_KEY.',
    )
  })

  test('sends Authorization bearer header and returns normalized usage', async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: {
            limits: [
              { type: 'five_hour', percentUsed: 25, resetsAt: '2026-06-29T22:00:00.000Z' },
            ],
          },
        }),
        { status: 200 },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await fetchClinePassUsage()

    expect(result.availability).toBe('available')
    expect(result.windows).toEqual([
      { label: '5-Hour Limit', type: 'five_hour', usedPercent: 25, resetsAt: '2026-06-29T22:00:00.000Z' },
    ])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(getClinePassUsageUrl())
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer cp-test-key')
  })

  test('returns unknown availability on non-OK response', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('Unauthorized', { status: 401 })
    }) as unknown as typeof globalThis.fetch

    const result = await fetchClinePassUsage()

    expect(result.availability).toBe('unknown')
    expect(result.windows).toEqual([])
  })

  test('propagates network errors', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('net failure')
    }) as unknown as typeof globalThis.fetch

    await expect(fetchClinePassUsage()).rejects.toThrow('net failure')
  })
})

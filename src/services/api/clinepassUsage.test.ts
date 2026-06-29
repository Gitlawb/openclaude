import { describe, expect, test } from 'bun:test'
import {
  buildClinePassUsageRows,
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

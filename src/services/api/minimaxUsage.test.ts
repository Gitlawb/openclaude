import { describe, expect, test } from 'bun:test'

import {
  buildMiniMaxUsageRows,
  getMiniMaxUsageUrls,
  normalizeMiniMaxUsagePayload,
} from './minimaxUsage.js'

describe('normalizeMiniMaxUsagePayload', () => {
  test('normalizes interval and weekly quota payloads', () => {
    const usage = normalizeMiniMaxUsagePayload({
      plan_type: 'plus_highspeed',
      data: {
        'MiniMax-M2.7-highspeed': {
          current_interval_usage_count: 4200,
          max_interval_usage_count: 4500,
          current_weekly_usage_count: 43000,
          max_weekly_usage_count: 45000,
        },
      },
    })

    expect(usage).toMatchObject({
      availability: 'available',
      planType: 'Plus Highspeed',
      snapshots: [
        {
          limitName: 'MiniMax-M2.7-highspeed',
          windows: [
            {
              label: '5h limit',
              usedPercent: 7,
              remaining: 4200,
              total: 4500,
            },
            {
              label: 'Weekly limit',
              usedPercent: 4,
              remaining: 43000,
              total: 45000,
            },
          ],
        },
      ],
    })
  })

  test('normalizes daily quota payloads from generic usage records', () => {
    const usage = normalizeMiniMaxUsagePayload({
      models: {
        image_01: {
          daily_remaining: 12,
          daily_quota: 50,
        },
      },
    })

    expect(usage).toMatchObject({
      availability: 'available',
      snapshots: [
        {
          limitName: 'image_01',
          windows: [
            {
              label: 'Daily limit',
              usedPercent: 76,
              remaining: 12,
              total: 50,
            },
          ],
        },
      ],
    })
  })

  test('returns unknown availability when no quota windows can be parsed', () => {
    const usage = normalizeMiniMaxUsagePayload({
      message: 'pay as you go key',
      ok: true,
    })

    expect(usage).toEqual({
      availability: 'unknown',
      planType: undefined,
      snapshots: [],
      message:
        'Usage details are not available for this MiniMax account. This may be a pay-as-you-go key or a plan that does not expose quota status.',
    })
  })
})

describe('buildMiniMaxUsageRows', () => {
  test('builds provider-prefixed labels and remaining subtext', () => {
    const rows = buildMiniMaxUsageRows([
      {
        limitName: 'MiniMax-M2.7',
        windows: [
          {
            label: '5h limit',
            usedPercent: 20,
            remaining: 1200,
            total: 1500,
          },
          {
            label: 'Weekly limit',
            usedPercent: 10,
            remaining: 13500,
            total: 15000,
          },
        ],
      },
      {
        limitName: 'image_01',
        windows: [
          {
            label: 'Daily limit',
            usedPercent: 76,
            remaining: 12,
            total: 50,
          },
        ],
      },
    ])

    expect(rows).toEqual([
      {
        kind: 'text',
        label: 'MiniMax-M2.7 quota',
        value: '',
      },
      {
        kind: 'window',
        label: '5h limit',
        usedPercent: 20,
        resetsAt: undefined,
        extraSubtext: '1200/1500 remaining',
      },
      {
        kind: 'window',
        label: 'Weekly limit',
        usedPercent: 10,
        resetsAt: undefined,
        extraSubtext: '13500/15000 remaining',
      },
      {
        kind: 'window',
        label: 'Image 01 Daily limit',
        usedPercent: 76,
        resetsAt: undefined,
        extraSubtext: '12/50 remaining',
      },
    ])
  })
})

describe('MiniMax usage helpers', () => {
  test('returns both documented and fallback usage endpoints', () => {
    expect(getMiniMaxUsageUrls('https://api.minimax.io/v1')).toEqual([
      'https://www.minimax.io/v1/token_plan/remains',
      'https://api.minimax.io/v1/token_plan/remains',
      'https://www.minimax.io/v1/api/openplatform/coding_plan/remains',
      'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
    ])
  })
})

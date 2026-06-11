import { describe, expect, test } from 'bun:test'

import {
  buildCodexUsageRows,
  formatCodexPlanType,
  getCodexUsageUrl,
  normalizeCodexUsagePayload,
} from './codexUsage.js'

describe('normalizeCodexUsagePayload', () => {
  test('normalizes live Codex usage payloads from /backend-api/wham/usage', () => {
    const usage = normalizeCodexUsagePayload({
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 38,
          limit_window_seconds: 18_000,
          reset_at: 1_775_154_358,
        },
        secondary_window: {
          used_percent: 32,
          limit_window_seconds: 604_800,
          reset_at: 1_775_685_041,
        },
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 604_800,
          reset_at: 1_775_744_471,
        },
        secondary_window: null,
      },
      credits: {
        has_credits: false,
        unlimited: false,
        balance: '0',
      },
    })

    expect(usage.planType).toBe('plus')
    expect(usage.snapshots).toHaveLength(2)
    expect(usage.snapshots[0]).toMatchObject({
      limitName: 'codex',
      primary: {
        usedPercent: 38,
        windowMinutes: 300,
      },
      secondary: {
        usedPercent: 32,
        windowMinutes: 10_080,
      },
    })
    expect(usage.snapshots[1]).toMatchObject({
      limitName: 'code review',
      primary: {
        usedPercent: 0,
        windowMinutes: 10_080,
      },
    })
  })

  test('supports direct protocol-style snapshot collections', () => {
    const usage = normalizeCodexUsagePayload({
      rateLimitsByLimitId: {
        codex: {
          limit_name: 'codex',
          primary: {
            used_percent: 12,
            window_minutes: 300,
            resets_at: 1_700_000_000,
          },
          credits: {
            has_credits: true,
            unlimited: false,
            balance: '25',
          },
        },
      },
    })

    expect(usage.snapshots).toEqual([
      {
        limitName: 'codex',
        primary: {
          usedPercent: 12,
          windowMinutes: 300,
          resetsAt: new Date(1_700_000_000 * 1000).toISOString(),
        },
        secondary: undefined,
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: '25',
        },
      },
    ])
  })
})

describe('buildCodexUsageRows', () => {
  test('builds Codex-like labels for primary and secondary windows', () => {
    const rows = buildCodexUsageRows([
      {
        limitName: 'codex',
        primary: {
          usedPercent: 38,
          windowMinutes: 300,
          resetsAt: '2026-04-02T10:00:00.000Z',
        },
        secondary: {
          usedPercent: 32,
          windowMinutes: 10_080,
          resetsAt: '2026-04-09T10:00:00.000Z',
        },
      },
      {
        limitName: 'code review',
        primary: {
          usedPercent: 0,
          windowMinutes: 10_080,
          resetsAt: '2026-04-09T10:00:00.000Z',
        },
      },
    ])

    expect(rows).toEqual([
      {
        kind: 'window',
        label: '5h limit',
        usedPercent: 38,
        resetsAt: '2026-04-02T10:00:00.000Z',
      },
      {
        kind: 'window',
        label: 'Weekly limit',
        usedPercent: 32,
        resetsAt: '2026-04-09T10:00:00.000Z',
      },
      {
        kind: 'window',
        label: 'Code review Weekly limit',
        usedPercent: 0,
        resetsAt: '2026-04-09T10:00:00.000Z',
      },
    ])
  })

  test('renders credits rows only when credits are available', () => {
    const rows = buildCodexUsageRows([
      {
        limitName: 'codex',
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: '25.2',
        },
      },
      {
        limitName: 'code review',
        credits: {
          hasCredits: true,
          unlimited: true,
        },
      },
      {
        limitName: 'other',
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: '0',
        },
      },
    ])

    expect(rows).toEqual([
      {
        kind: 'text',
        label: 'Credits',
        value: '25 credits',
      },
      {
        kind: 'text',
        label: 'Code review limit',
        value: '',
      },
      {
        kind: 'text',
        label: 'Credits',
        value: 'Unlimited',
      },
    ])
  })
})

describe('Codex usage helpers', () => {
  test('formats plan labels and usage endpoint url', () => {
    expect(formatCodexPlanType('team_max')).toBe('Team Max')
    expect(getCodexUsageUrl()).toBe(
      'https://chatgpt.com/backend-api/wham/usage',
    )
    expect(getCodexUsageUrl('https://chatgpt.com/backend-api/codex')).toBe(
      'https://chatgpt.com/backend-api/wham/usage',
    )
  })
})

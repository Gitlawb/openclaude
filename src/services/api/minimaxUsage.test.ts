import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'

import {
  buildMiniMaxUsageRows,
  fetchMiniMaxUsage,
  getMiniMaxUsageUrls,
  normalizeMiniMaxUsagePayload,
} from './minimaxUsage.js'

const fixture = (name: string) =>
  Bun.file(resolve(import.meta.dir, '__fixtures__', name))

// Snapshot every base-URL alias that resolveConfiguredMiniMaxUsageBaseUrl
// consults, so tests start from a known state and afterEach can restore the
// caller's environment without leaking aliases the test deleted.
const MINIMAX_USAGE_BASE_URL_KEYS = [
  'ANTHROPIC_BASE_URL',
  'MINIMAX_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
] as const

let originalBaseUrlEnv: Record<(typeof MINIMAX_USAGE_BASE_URL_KEYS)[number], string | undefined>

beforeEach(async () => {
  await acquireSharedMutationLock('minimaxUsage.test.ts')
  originalBaseUrlEnv = {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    MINIMAX_BASE_URL: process.env.MINIMAX_BASE_URL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  }
  for (const key of MINIMAX_USAGE_BASE_URL_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of MINIMAX_USAGE_BASE_URL_KEYS) {
    const original = originalBaseUrlEnv[key]
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
  releaseSharedMutationLock()
})

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
              usedPercent: 93,
              remaining: 300,
              total: 4500,
            },
            {
              label: 'Weekly limit',
              usedPercent: 96,
              remaining: 2000,
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

  test('normalizes MiniMax model_remains payloads from a captured fixture', async () => {
    const payload = await fixture('minimax-model-remains.json').json()
    const originalDateNow = Date.now
    Date.now = () => Date.parse('2026-02-20T15:00:00.000Z')

    try {
      const usage = normalizeMiniMaxUsagePayload(payload)

      expect(usage).toMatchObject({
        availability: 'available',
        planType: 'Plus Highspeed',
        snapshots: [
          {
            limitName: 'MiniMax-M2.7',
            windows: [
              {
                label: '5h limit',
                usedPercent: 96,
                remaining: 63,
                total: 1500,
                resetsAt: '2026-02-20T16:00:00.000Z',
              },
            ],
          },
          {
            limitName: 'MiniMax-M2.7-highspeed',
            windows: [
              {
                label: '5h limit',
                usedPercent: 50,
                remaining: 1000,
                total: 2000,
                resetsAt: '2026-02-20T16:00:00.000Z',
              },
            ],
          },
        ],
      })
    } finally {
      Date.now = originalDateNow
    }
  })

  test('treats current_interval_usage_count as used count for MiniMax subscription payloads', () => {
    const usage = normalizeMiniMaxUsagePayload({
      model_remains: [
        {
          current_interval_total_count: 1500,
          current_interval_usage_count: 1,
          model_name: 'MiniMax-M2.7',
        },
      ],
    })

    expect(usage).toMatchObject({
      availability: 'available',
      snapshots: [
        {
          limitName: 'MiniMax-M2.7',
          windows: [
            {
              label: '5h limit',
              usedPercent: 0,
              remaining: 1499,
              total: 1500,
            },
          ],
        },
      ],
    })
  })

  test('treats MiniMax usage_percent as remaining percentage', () => {
    const usage = normalizeMiniMaxUsagePayload({
      model_remains: [
        {
          model_name: 'MiniMax-M2.7-highspeed',
          usage_percent: 96,
        },
      ],
    })

    expect(usage).toMatchObject({
      availability: 'available',
      snapshots: [
        {
          limitName: 'MiniMax-M2.7-highspeed',
          windows: [
            {
              label: '5h limit',
              usedPercent: 4,
            },
          ],
        },
      ],
    })
  })

  test('returns unknown availability when no quota windows can be parsed', () => {
    const usage = normalizeMiniMaxUsagePayload({
      message: 'quota status unavailable',
      ok: true,
    })

    expect(usage).toEqual({
      availability: 'unknown',
      planType: undefined,
      snapshots: [],
      message:
        'Usage details are not available for this MiniMax account. This plan or MiniMax endpoint may not expose quota status.',
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
  test('keeps usage endpoints on the configured provider host and path', () => {
    expect(
      getMiniMaxUsageUrls('https://proxy.example/providers/minimax/v1'),
    ).toEqual([
      'https://proxy.example/providers/minimax/v1/token_plan/remains',
      'https://proxy.example/providers/minimax/v1/api/openplatform/coding_plan/remains',
    ])
  })

  test('falls back to overseas default for a non-MiniMax OPENAI_API_BASE (#2207 P1 follow-up)', () => {
    const originalBaseUrl = process.env.OPENAI_BASE_URL
    const originalApiBase = process.env.OPENAI_API_BASE
    delete process.env.OPENAI_BASE_URL
    process.env.OPENAI_API_BASE = 'https://gateway.example/openai/v1'

    try {
      // Custom non-MiniMax URLs cannot serve the MiniMax quota API. We
      // honor the proxy's own credential scheme and fall back to the
      // overseas default to avoid forwarding a MiniMax key to an unrelated
      // host.
      expect(getMiniMaxUsageUrls()).toEqual([
        'https://api.minimax.io/v1/token_plan/remains',
        'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
      ])
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.OPENAI_BASE_URL
      } else {
        process.env.OPENAI_BASE_URL = originalBaseUrl
      }

      if (originalApiBase === undefined) {
        delete process.env.OPENAI_API_BASE
      } else {
        process.env.OPENAI_API_BASE = originalApiBase
      }
    }
  })

  test('throws when an explicitly configured MiniMax base url is invalid', () => {
    expect(() => getMiniMaxUsageUrls('not a url')).toThrow(
      'MiniMax usage base URL is invalid: not a url',
    )
  })

  test('uses the default MiniMax base url when no provider base is configured', () => {
    const originalBaseUrl = process.env.OPENAI_BASE_URL
    const originalApiBase = process.env.OPENAI_API_BASE
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE

    try {
      expect(getMiniMaxUsageUrls()).toEqual([
        'https://api.minimax.io/v1/token_plan/remains',
        'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
      ])
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.OPENAI_BASE_URL
      } else {
        process.env.OPENAI_BASE_URL = originalBaseUrl
      }

      if (originalApiBase === undefined) {
        delete process.env.OPENAI_API_BASE
      } else {
        process.env.OPENAI_API_BASE = originalApiBase
      }
    }
  })

  test('routes default MiniMax usage URL to China when CN host is configured (#2207 P2)', () => {
    // P2 finding: when a China MiniMax key user has only OPENAI_BASE_URL
    // set to api.minimaxi.com/v1 (no ANTHROPIC_BASE_URL), the usage path
    // must default to api.minimaxi.com — not the overseas api.minimax.io,
    // which would forward the China bearer to the wrong quota endpoint.
    const originalBaseUrl = process.env.OPENAI_BASE_URL
    const originalApiBase = process.env.OPENAI_API_BASE
    process.env.OPENAI_BASE_URL = 'https://api.minimaxi.com/v1'
    delete process.env.OPENAI_API_BASE

    try {
      expect(getMiniMaxUsageUrls()).toEqual([
        'https://api.minimaxi.com/v1/token_plan/remains',
        'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains',
      ])
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.OPENAI_BASE_URL
      } else {
        process.env.OPENAI_BASE_URL = originalBaseUrl
      }

      if (originalApiBase === undefined) {
        delete process.env.OPENAI_API_BASE
      } else {
        process.env.OPENAI_API_BASE = originalApiBase
      }
    }
  })
})

describe('fetchMiniMaxUsage credential guard (#2207 P1)', () => {
  test('throws a clear error when only OPENAI_API_KEY is set', async () => {
    const originalMiniMax = process.env.MINIMAX_API_KEY
    const originalOpenAI = process.env.OPENAI_API_KEY
    delete process.env.MINIMAX_API_KEY
    process.env.OPENAI_API_KEY = 'openai-test-key'

    try {
      await expect(fetchMiniMaxUsage()).rejects.toThrow(/MINIMAX_API_KEY/)
    } finally {
      if (originalMiniMax === undefined) {
        delete process.env.MINIMAX_API_KEY
      } else {
        process.env.MINIMAX_API_KEY = originalMiniMax
      }
      if (originalOpenAI === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalOpenAI
      }
    }
  })

  test('throws a clear error when MINIMAX_API_KEY is whitespace-only', async () => {
    const originalMiniMax = process.env.MINIMAX_API_KEY
    const originalOpenAI = process.env.OPENAI_API_KEY
    process.env.MINIMAX_API_KEY = '   '
    process.env.OPENAI_API_KEY = 'openai-test-key'

    try {
      await expect(fetchMiniMaxUsage()).rejects.toThrow(/MINIMAX_API_KEY/)
    } finally {
      if (originalMiniMax === undefined) {
        delete process.env.MINIMAX_API_KEY
      } else {
        process.env.MINIMAX_API_KEY = originalMiniMax
      }
      if (originalOpenAI === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalOpenAI
      }
    }
  })
})

describe('getMiniMaxUsageUrls with active profile aliases (#2207 P2)', () => {
  test('translates Anthropic-shaped ANTHROPIC_BASE_URL to the China quota /v1 root', () => {
    // Profile application clears OPENAI_BASE_URL but emits ANTHROPIC_BASE_URL
    // (Anthropic-shaped, e.g. `…/anthropic`). The quota API is OpenAI-shaped
    // and lives under `/v1`, so the usage path must translate the chat
    // base to the quota base before composing token_plan/remains
    // (#2207 P1 follow-up from jatmn).
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'

    expect(getMiniMaxUsageUrls()).toEqual([
      'https://api.minimaxi.com/v1/token_plan/remains',
      'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains',
    ])
  })

  test('translates overseas Anthropic-shaped MINIMAX_BASE_URL to /v1 quota root', () => {
    process.env.MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic'

    expect(getMiniMaxUsageUrls()).toEqual([
      'https://api.minimax.io/v1/token_plan/remains',
      'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
    ])
  })

  test('ANTHROPIC_BASE_URL wins over MINIMAX_BASE_URL and OpenAI aliases', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    process.env.MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'

    expect(getMiniMaxUsageUrls()).toEqual([
      'https://api.minimaxi.com/v1/token_plan/remains',
      'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains',
    ])
  })

  test('keeps an explicit /v1 hint on /v1 quota root', () => {
    process.env.OPENAI_BASE_URL = 'https://api.minimaxi.com/v1'

    expect(getMiniMaxUsageUrls()).toEqual([
      'https://api.minimaxi.com/v1/token_plan/remains',
      'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains',
    ])
  })

  test('falls back to overseas default for a custom non-MiniMax proxy URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://my-anthropic-proxy.example/v1'

    // Custom proxy URLs cannot serve the MiniMax quota API; we honor the
    // proxy's own credential scheme and pick the overseas default to avoid
    // forwarding a MiniMax key to an unrelated host.
    expect(getMiniMaxUsageUrls()).toEqual([
      'https://api.minimax.io/v1/token_plan/remains',
      'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
    ])
  })
})

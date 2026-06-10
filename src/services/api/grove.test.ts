import { describe, expect, test } from 'bun:test'
import {
  calculateShouldShowGrove,
  type AccountSettings,
  type ApiResult,
  type GroveConfig,
} from './grove.js'

const DAY_MS = 24 * 60 * 60 * 1000

function settings(
  overrides: Partial<AccountSettings> = {},
): ApiResult<AccountSettings> {
  return {
    success: true,
    data: {
      grove_enabled: null,
      grove_notice_viewed_at: null,
      ...overrides,
    },
  }
}

function config(overrides: Partial<GroveConfig> = {}): ApiResult<GroveConfig> {
  return {
    success: true,
    data: {
      grove_enabled: true,
      domain_excluded: false,
      notice_is_grace_period: true,
      notice_reminder_frequency: null,
      ...overrides,
    },
  }
}

describe('calculateShouldShowGrove', () => {
  test('hides the dialog when either Grove API call failed', () => {
    expect(calculateShouldShowGrove({ success: false }, config(), false)).toBe(
      false,
    )
    expect(calculateShouldShowGrove(settings(), { success: false }, false)).toBe(
      false,
    )
  })

  test('hides the dialog after the user has already chosen either setting', () => {
    expect(
      calculateShouldShowGrove(
        settings({ grove_enabled: true }),
        config(),
        false,
      ),
    ).toBe(false)

    expect(
      calculateShouldShowGrove(
        settings({ grove_enabled: false }),
        config(),
        false,
      ),
    ).toBe(false)
  })

  test('uses reminder frequency during the grace period', () => {
    const recentlyViewed = new Date(Date.now() - 6 * DAY_MS).toISOString()
    const reminderExpired = new Date(Date.now() - 8 * DAY_MS).toISOString()
    const weeklyReminderConfig = config({ notice_reminder_frequency: 7 })

    expect(
      calculateShouldShowGrove(
        settings({ grove_notice_viewed_at: recentlyViewed }),
        weeklyReminderConfig,
        false,
      ),
    ).toBe(false)

    expect(
      calculateShouldShowGrove(
        settings({ grove_notice_viewed_at: reminderExpired }),
        weeklyReminderConfig,
        false,
      ),
    ).toBe(true)
  })

  test('can force display for settings even after the notice was already viewed', () => {
    expect(
      calculateShouldShowGrove(
        settings({ grove_notice_viewed_at: new Date().toISOString() }),
        config(),
        true,
      ),
    ).toBe(true)
  })

  test('shows the post-grace dialog until the user makes a choice', () => {
    expect(
      calculateShouldShowGrove(
        settings({ grove_notice_viewed_at: new Date().toISOString() }),
        config({ notice_is_grace_period: false }),
        false,
      ),
    ).toBe(true)
  })
})

import { describe, expect, test } from 'bun:test'
import { inclusiveCalendarDaySpan } from './stats.js'

describe('inclusiveCalendarDaySpan', () => {
  test('is 1 when both timestamps fall on the same UTC calendar day', () => {
    // Two sessions on the same day (01:00 and 20:00 UTC). The old
    // Math.ceil(rawGap) + 1 rounded the 19h partial day up to 1 and then added
    // 1, reporting 2 total days for a single active day.
    expect(
      inclusiveCalendarDaySpan(
        '2026-07-13T01:00:00.000Z',
        '2026-07-13T20:00:00.000Z',
      ),
    ).toBe(1)
  })

  test('counts calendar days inclusively across a multi-day span', () => {
    // 2026-07-13 .. 2026-07-15 inclusive = 3 days, regardless of time of day.
    expect(
      inclusiveCalendarDaySpan(
        '2026-07-13T22:00:00.000Z',
        '2026-07-15T06:00:00.000Z',
      ),
    ).toBe(3)
  })

  test('is 1 for identical timestamps', () => {
    const t = '2026-07-13T12:00:00.000Z'
    expect(inclusiveCalendarDaySpan(t, t)).toBe(1)
  })

  test('counts exactly two days for adjacent calendar days', () => {
    expect(
      inclusiveCalendarDaySpan(
        '2026-07-13T23:59:59.000Z',
        '2026-07-14T00:00:01.000Z',
      ),
    ).toBe(2)
  })
})

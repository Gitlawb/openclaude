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

  test('does not add a day when the later session is later in the day', () => {
    // The canonical off-by-one: the raw gap is 1.5 days, so the old
    // Math.ceil(gap) + 1 rounded up to 2 and then added the inclusive +1,
    // reporting 3 for a 2-calendar-day span. Unlike the spans above, this case
    // separates the two formulas, so it fails if the off-by-one comes back.
    expect(
      inclusiveCalendarDaySpan(
        '2026-07-13T06:00:00.000Z',
        '2026-07-14T18:00:00.000Z',
      ),
    ).toBe(2)
  })

  test('counts a longer non-midnight span by calendar day', () => {
    // Raw gap 3.5 days: old formula gave ceil(3.5) + 1 = 5, correct is 4.
    expect(
      inclusiveCalendarDaySpan(
        '2026-07-13T06:00:00.000Z',
        '2026-07-16T18:00:00.000Z',
      ),
    ).toBe(4)
  })

  test('accepts bare dailyActivity date keys', () => {
    // lastSessionDate can be derived from dailyActivity, which stores YYYY-MM-DD.
    expect(inclusiveCalendarDaySpan('2026-07-13', '2026-07-15')).toBe(3)
  })

  test('returns 0 for parseable but malformed persisted dates', () => {
    // Date.parse accepts all of these, silently producing a misleading span:
    // "2026-07" -> Jul 1, "2026" -> Jan 1, "123" -> year 0123, and a
    // non-ISO locale format. None is a shape this pipeline ever persists.
    for (const bad of ['2026-07', '2026', '123', '01/01/2026']) {
      expect(inclusiveCalendarDaySpan(bad, '2026-07-15T06:00:00.000Z')).toBe(0)
      expect(inclusiveCalendarDaySpan('2026-07-13T06:00:00.000Z', bad)).toBe(0)
    }
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

  test('returns 0 instead of throwing on an unparseable persisted date', () => {
    // A same-version stats cache can carry a corrupt firstSessionDate/last date
    // (e.g. "not-a-date"). Feeding that to toDateString → toISOString throws
    // RangeError and aborts /stats; the helper must degrade to 0 for either end.
    expect(() =>
      inclusiveCalendarDaySpan('not-a-date', '2026-07-15T06:00:00.000Z'),
    ).not.toThrow()
    expect(
      inclusiveCalendarDaySpan('not-a-date', '2026-07-15T06:00:00.000Z'),
    ).toBe(0)
    expect(
      inclusiveCalendarDaySpan('2026-07-13T22:00:00.000Z', 'not-a-date'),
    ).toBe(0)
    expect(inclusiveCalendarDaySpan('not-a-date', 'also-bad')).toBe(0)
  })

  test('returns 0 for impossible calendar dates instead of normalizing them', () => {
    // Date.parse rolls 2026-02-30 over to March 2, so a date-shaped-prefix
    // guard alone would fabricate a span (this exact pair returned 1) instead
    // of taking the documented 0 fallback.
    expect(inclusiveCalendarDaySpan('2026-02-30', '2026-03-02')).toBe(0)
    expect(inclusiveCalendarDaySpan('2026-07-13', '2026-13-01')).toBe(0)
    expect(inclusiveCalendarDaySpan('2026-00-10', '2026-07-13')).toBe(0)
    expect(inclusiveCalendarDaySpan('2026-07-00', '2026-07-13')).toBe(0)
    expect(inclusiveCalendarDaySpan('2026-04-31', '2026-05-01')).toBe(0)
  })

  test('rejects February 29 only in non-leap years', () => {
    // Non-leap 2026: impossible, must not normalize to March 1.
    expect(inclusiveCalendarDaySpan('2026-02-29', '2026-03-01')).toBe(0)
    // Leap 2024: a real day, spans inclusively to March 1.
    expect(inclusiveCalendarDaySpan('2024-02-29', '2024-03-01')).toBe(2)
  })
})

import { expect, test } from 'bun:test'

import { sanitizeModelName } from './commitAttribution.ts'

// Regression for #1769: opus-4-8 and opus-4-7 must map to their own public
// names, not fall through to the broad `claude-opus-4` branch (which would
// mislabel commit/PR attribution for first-party Opus 4.8/4.7 sessions).
test('sanitizeModelName maps Opus 4.8 and 4.7 to their public names', () => {
  expect(sanitizeModelName('claude-opus-4-8')).toBe('claude-opus-4-8')
  expect(sanitizeModelName('claude-opus-4-8[1m]')).toBe('claude-opus-4-8')
  expect(sanitizeModelName('claude-opus-4-7')).toBe('claude-opus-4-7')
  expect(sanitizeModelName('claude-opus-4-7[1m]')).toBe('claude-opus-4-7')
  // Existing families still resolve correctly.
  expect(sanitizeModelName('claude-opus-4-6')).toBe('claude-opus-4-6')
  // A genuinely unknown opus-4 variant still falls back to the family name.
  expect(sanitizeModelName('claude-opus-4-2')).toBe('claude-opus-4')
})

import { expect, test } from 'bun:test'

import { sanitizeModelName, sanitizeSurfaceKey } from './commitAttribution.ts'

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

test('sanitizeModelName maps Claude 5 ids and leaves near matches generic', () => {
  expect(sanitizeModelName('claude-opus-5')).toBe('claude-opus-5')
  expect(sanitizeModelName('claude-opus-5[1m]')).toBe('claude-opus-5')
  expect(sanitizeModelName('us.anthropic.claude-opus-5-v1:0')).toBe(
    'claude-opus-5',
  )
  expect(sanitizeModelName('claude-sonnet-5')).toBe('claude-sonnet-5')
  expect(sanitizeModelName('anthropic/claude-sonnet-5')).toBe('claude-sonnet-5')
  expect(sanitizeModelName('claude-opus-50')).toBe('claude')
  expect(sanitizeModelName('claude-sonnet-50')).toBe('claude')
  expect(sanitizeModelName('arbitrary-proxy-opus-5')).toBe('claude')
})

test('sanitizeSurfaceKey maps Claude 5 surfaces and leaves near matches generic', () => {
  expect(sanitizeSurfaceKey('cli/claude-opus-5')).toBe('cli/claude-opus-5')
  expect(sanitizeSurfaceKey('cli/claude-sonnet-5')).toBe('cli/claude-sonnet-5')
  expect(sanitizeSurfaceKey('cli/claude-opus-50')).toBe('cli/claude')
  expect(sanitizeSurfaceKey('cli/arbitrary-proxy-opus-5')).toBe('cli/claude')
})

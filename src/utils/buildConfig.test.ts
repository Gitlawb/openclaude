import { expect, test } from 'bun:test'
import { isAntEmployee } from './buildConfig.ts'

// Finding #42-2: process.env.USER_TYPE === 'ant' is checked directly in multiple
// places, allowing any external user to activate Anthropic-internal code paths.
// In OpenLawb, this must always be false regardless of env var.

test('isAntEmployee always returns false in OpenLawb regardless of USER_TYPE env var', () => {
  const original = process.env.USER_TYPE
  process.env.USER_TYPE = 'ant'
  expect(isAntEmployee()).toBe(false)
  process.env.USER_TYPE = original
})

test('isAntEmployee returns false even when USER_TYPE is unset', () => {
  const original = process.env.USER_TYPE
  delete process.env.USER_TYPE
  expect(isAntEmployee()).toBe(false)
  process.env.USER_TYPE = original
})

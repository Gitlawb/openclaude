import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { modelSupportsAdvisor, isValidAdvisorModel } from './advisor.ts'

const originalUserType = process.env.USER_TYPE

beforeEach(() => {
  // The advisor allowlist short-circuits to true for USER_TYPE=ant; force a
  // non-ant value so the model gate is what's actually exercised.
  process.env.USER_TYPE = 'external'
})

afterEach(() => {
  if (originalUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = originalUserType
})

// Regression for #1769: the advisor allowlist only matched opus-4-6/sonnet-4-6,
// so first-party sessions on the new default claude-opus-4-8 reported the model
// did not support the advisor tool.
describe('advisor model gate covers the current default Opus', () => {
  test('modelSupportsAdvisor allows recent Opus (4.8/4.7/4.6) and sonnet-4-6', () => {
    expect(modelSupportsAdvisor('claude-opus-4-8')).toBe(true)
    expect(modelSupportsAdvisor('claude-opus-4-7')).toBe(true)
    expect(modelSupportsAdvisor('claude-opus-4-6')).toBe(true)
    expect(modelSupportsAdvisor('claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsAdvisor('claude-opus-4-1')).toBe(false)
  })

  test('isValidAdvisorModel allows recent Opus (4.8/4.7/4.6) and sonnet-4-6', () => {
    expect(isValidAdvisorModel('claude-opus-4-8')).toBe(true)
    expect(isValidAdvisorModel('claude-opus-4-7')).toBe(true)
    expect(isValidAdvisorModel('claude-opus-4-6')).toBe(true)
    expect(isValidAdvisorModel('claude-sonnet-4-6')).toBe(true)
    expect(isValidAdvisorModel('claude-opus-4-1')).toBe(false)
  })
})

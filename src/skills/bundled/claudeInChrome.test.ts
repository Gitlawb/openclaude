import { describe, expect, test } from 'bun:test'
import { shouldEnableClaudeInChromeSkill } from './claudeInChromeAccess.js'

describe('shouldEnableClaudeInChromeSkill', () => {
  test('requires both auto-enable eligibility and subscriber access', () => {
    expect(
      shouldEnableClaudeInChromeSkill({
        autoEnabled: true,
        hasClaudeInChromeAccess: true,
      }),
    ).toBe(true)

    expect(
      shouldEnableClaudeInChromeSkill({
        autoEnabled: true,
        hasClaudeInChromeAccess: false,
      }),
    ).toBe(false)

    expect(
      shouldEnableClaudeInChromeSkill({
        autoEnabled: false,
        hasClaudeInChromeAccess: true,
      }),
    ).toBe(false)
  })
})

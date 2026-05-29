import { describe, expect, test } from 'bun:test'
import { isAutoUpdateBlockedForThirdParty } from './update.js'

// Regression for #1404 — `openclaude update` was gated on
// `getAPIProvider() !== 'firstParty'`, which blocked auto-update for every
// OpenClaude user running any third-party provider, even though OpenClaude
// builds reinstall their own `@gitlawb/openclaude` package (not the Anthropic
// binary) and are therefore safe to update.
describe('isAutoUpdateBlockedForThirdParty (#1404)', () => {
  test('OpenClaude-packaged build is never blocked, regardless of provider', () => {
    expect(isAutoUpdateBlockedForThirdParty('@gitlawb/openclaude', 'openai')).toBe(false)
    expect(isAutoUpdateBlockedForThirdParty('@gitlawb/openclaude', 'mistral')).toBe(false)
    expect(isAutoUpdateBlockedForThirdParty('@gitlawb/openclaude', 'firstParty')).toBe(false)
  })

  test('Anthropic-packaged build is blocked when a third-party provider is active', () => {
    expect(isAutoUpdateBlockedForThirdParty('@anthropic-ai/claude-code', 'openai')).toBe(true)
    expect(isAutoUpdateBlockedForThirdParty('@anthropic-ai/claude-code', 'gemini')).toBe(true)
  })

  test('Anthropic-packaged build is allowed on the first-party provider', () => {
    expect(isAutoUpdateBlockedForThirdParty('@anthropic-ai/claude-code', 'firstParty')).toBe(false)
  })

  test('missing package URL is treated as the Anthropic build (conservative)', () => {
    expect(isAutoUpdateBlockedForThirdParty(undefined, 'openai')).toBe(true)
    expect(isAutoUpdateBlockedForThirdParty(undefined, 'firstParty')).toBe(false)
  })
})

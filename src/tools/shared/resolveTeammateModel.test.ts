/**
 * Tests for resolveTeammateModel — the new behaviors added in this PR:
 *   - Whitespace normalization for inputModel
 *   - Case-insensitive 'inherit' handling
 *   - Allowlist validation via isModelAllowed
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { resetSettingsCache, setSessionSettingsCache } from '../../utils/settings/settingsCache.js'
import { resolveTeammateModel } from './spawnMultiAgent.js'

// Use test env so getGlobalConfig() returns TEST_GLOBAL_CONFIG_FOR_TESTING
// (avoids disk reads and gives a predictable default state).
// Captured and restored to avoid leaking into other test files.
const originalNodeEnv = process.env.NODE_ENV

beforeAll(() => {
  process.env.NODE_ENV = 'test'
})

afterAll(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
})

function allowAllModels() {
  setSessionSettingsCache({ settings: {}, errors: [] })
}

function restrictToAllowlist(availableModels: string[]) {
  setSessionSettingsCache({ settings: { availableModels }, errors: [] })
}

beforeEach(allowAllModels)
afterEach(resetSettingsCache)

describe('resolveTeammateModel — inherit behavior', () => {
  test('"inherit" uses the leader model directly', () => {
    const result = resolveTeammateModel('inherit', 'claude-sonnet-4-6')
    expect(result).toBe('claude-sonnet-4-6')
  })

  test('"INHERIT" is handled case-insensitively', () => {
    const result = resolveTeammateModel('INHERIT', 'claude-sonnet-4-6')
    expect(result).toBe('claude-sonnet-4-6')
  })

  test('"Inherit" (mixed case) is handled case-insensitively', () => {
    const result = resolveTeammateModel('Inherit', 'claude-sonnet-4-6')
    expect(result).toBe('claude-sonnet-4-6')
  })

  test('"inherit" falls back to hardcoded fallback when leaderModel is null', () => {
    const result = resolveTeammateModel('inherit', null)
    // With firstParty provider, fallback is claude-opus-4-6
    expect(result).toContain('opus')
  })
})

describe('resolveTeammateModel — undefined / whitespace normalization', () => {
  test('undefined inputModel falls back to the hardcoded teammate default', () => {
    const result = resolveTeammateModel(undefined, 'claude-sonnet-4-6')
    // Default when not configured is getHardcodedTeammateModelFallback() = opus 4.6
    expect(result).toContain('opus')
  })

  test('empty string normalized to undefined → uses default', () => {
    const result = resolveTeammateModel('', 'claude-sonnet-4-6')
    expect(result).toContain('opus')
  })

  test('whitespace-only string normalized to undefined → uses default', () => {
    const result = resolveTeammateModel('   ', 'claude-sonnet-4-6')
    expect(result).toContain('opus')
  })
})

describe('resolveTeammateModel — explicit model string', () => {
  test('resolves a model alias to the concrete model name', () => {
    const result = resolveTeammateModel('sonnet', 'claude-opus-4-6')
    expect(result).toContain('sonnet')
  })

  test('passes through an unknown/arbitrary model string unchanged', () => {
    // Non-alias strings go through parseUserSpecifiedModel which returns them as-is
    const result = resolveTeammateModel('gpt-4o', 'claude-opus-4-6')
    expect(result).toBe('gpt-4o')
  })
})

describe('resolveTeammateModel — allowlist enforcement', () => {
  test('throws when resolved model is not in the allowlist', () => {
    restrictToAllowlist(['sonnet'])
    expect(() => resolveTeammateModel('haiku', 'claude-sonnet-4-6')).toThrow(
      "is not allowed by your organization's model policy",
    )
  })

  test('throws with /model hint in the error message', () => {
    restrictToAllowlist(['sonnet'])
    expect(() => resolveTeammateModel('haiku', 'claude-sonnet-4-6')).toThrow(
      'Run /model to see the allowed models',
    )
  })

  test('does not throw when resolved model is in the allowlist', () => {
    restrictToAllowlist(['sonnet'])
    expect(() => resolveTeammateModel('sonnet', 'claude-opus-4-6')).not.toThrow()
  })

  test('throws when "inherit" resolves to a model not in the allowlist', () => {
    restrictToAllowlist(['sonnet'])
    // inherit → leader model (opus) → not in allowlist
    expect(() => resolveTeammateModel('inherit', 'claude-opus-4-6')).toThrow(
      "is not allowed by your organization's model policy",
    )
  })
})

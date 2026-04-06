/**
 * Tests for resolveTeammateModel — the new behaviors added in this PR:
 *   - Whitespace normalization for inputModel
 *   - Case-insensitive 'inherit' handling
 *   - Allowlist validation via isModelAllowed
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { getHardcodedTeammateModelFallback } from '../../utils/swarm/teammateModel.js'
import { resetSettingsCache, setSessionSettingsCache } from '../../utils/settings/settingsCache.js'
import { resolveTeammateModel } from './spawnMultiAgent.js'

// Provider env vars that affect getAPIProvider() and therefore model resolution.
// Cleared before each test so results are deterministic regardless of CI env.
const PROVIDER_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
] as const

// Use test env so getGlobalConfig() returns TEST_GLOBAL_CONFIG_FOR_TESTING
// (avoids disk reads and gives a predictable default state).
// Captured and restored to avoid leaking into other test files.
const originalNodeEnv = process.env.NODE_ENV
const savedProviderEnv: Partial<Record<(typeof PROVIDER_ENV_KEYS)[number], string | undefined>> = {}

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

beforeEach(() => {
  allowAllModels()
  for (const key of PROVIDER_ENV_KEYS) {
    savedProviderEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  resetSettingsCache()
  for (const key of PROVIDER_ENV_KEYS) {
    const val = savedProviderEnv[key]
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
})

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
    expect(result).toBe(getHardcodedTeammateModelFallback())
  })
})

describe('resolveTeammateModel — undefined / whitespace normalization', () => {
  test('undefined inputModel falls back to the hardcoded teammate default', () => {
    const result = resolveTeammateModel(undefined, 'claude-sonnet-4-6')
    expect(result).toBe(getHardcodedTeammateModelFallback())
  })

  test('empty string normalized to undefined → uses default', () => {
    const result = resolveTeammateModel('', 'claude-sonnet-4-6')
    expect(result).toBe(getHardcodedTeammateModelFallback())
  })

  test('whitespace-only string normalized to undefined → uses default', () => {
    const result = resolveTeammateModel('   ', 'claude-sonnet-4-6')
    expect(result).toBe(getHardcodedTeammateModelFallback())
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

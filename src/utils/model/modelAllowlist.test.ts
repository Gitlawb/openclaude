import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetSettingsCache, setSessionSettingsCache } from '../settings/settingsCache.js'
import { isModelAllowed } from './modelAllowlist.js'

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

const savedProviderEnv: Partial<Record<(typeof PROVIDER_ENV_KEYS)[number], string | undefined>> =
  {}

beforeEach(() => {
  // Snapshot and clear provider env vars so getAPIProvider() returns 'firstParty'
  // and model alias resolution is deterministic regardless of test order.
  for (const key of PROVIDER_ENV_KEYS) {
    savedProviderEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  resetSettingsCache()
  // Restore provider env vars
  for (const key of PROVIDER_ENV_KEYS) {
    const val = savedProviderEnv[key]
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
})

function withAllowlist(availableModels: string[]) {
  setSessionSettingsCache({ settings: { availableModels }, errors: [] })
}

describe('isModelAllowed — no restrictions', () => {
  test('returns true when availableModels is not set', () => {
    setSessionSettingsCache({ settings: {}, errors: [] })
    expect(isModelAllowed('claude-sonnet-4-6')).toBe(true)
    expect(isModelAllowed('gpt-4o')).toBe(true)
  })

  test('returns false when availableModels is empty', () => {
    withAllowlist([])
    expect(isModelAllowed('claude-sonnet-4-6')).toBe(false)
  })
})

describe('isModelAllowed — Bedrock model ID normalization', () => {
  test('cross-region inference profile allowed when family alias is in allowlist', () => {
    withAllowlist(['sonnet'])
    expect(isModelAllowed('eu.anthropic.claude-sonnet-4-5-v1:0')).toBe(true)
    expect(isModelAllowed('us.anthropic.claude-sonnet-4-5-v1:0')).toBe(true)
    expect(isModelAllowed('apac.anthropic.claude-sonnet-4-5-v1:0')).toBe(true)
  })

  test('cross-region inference profile allowed when canonical name is in allowlist', () => {
    withAllowlist(['claude-sonnet-4-5'])
    expect(isModelAllowed('eu.anthropic.claude-sonnet-4-5-v1:0')).toBe(true)
  })

  test('cross-region inference profile for opus allowed by opus family alias', () => {
    withAllowlist(['opus'])
    expect(isModelAllowed('us.anthropic.claude-opus-4-6-v1:0')).toBe(true)
  })

  test('foundation model (no region prefix) allowed by family alias', () => {
    withAllowlist(['haiku'])
    expect(isModelAllowed('anthropic.claude-haiku-4-5-v1:0')).toBe(true)
  })

  test('Bedrock ARN allowed when canonical form matches allowlist entry', () => {
    withAllowlist(['sonnet'])
    expect(
      isModelAllowed(
        'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-v1:0',
      ),
    ).toBe(true)
  })

  test('Bedrock model blocked when different family is in allowlist', () => {
    withAllowlist(['opus'])
    expect(isModelAllowed('eu.anthropic.claude-sonnet-4-5-v1:0')).toBe(false)
  })

  test('custom deployment name is NOT normalized — not accidentally allowed', () => {
    withAllowlist(['claude-sonnet-4-5'])
    // A custom name that happens to contain "sonnet" but is not a valid Bedrock pattern
    // should not be normalized and should not match
    expect(isModelAllowed('my-sonnet-deployment')).toBe(false)
  })

  test('Bedrock model not allowed when specific version restricts the family alias', () => {
    // When allowlist has both "opus" and "opus-4-5", the family wildcard is suppressed
    withAllowlist(['opus', 'opus-4-5'])
    expect(isModelAllowed('us.anthropic.claude-opus-4-6-v1:0')).toBe(false)
    expect(isModelAllowed('us.anthropic.claude-opus-4-5-v1:0')).toBe(true)
  })
})

describe('isModelAllowed — Vertex model ID normalization', () => {
  test('Vertex model with @date suffix allowed when family alias is in allowlist', () => {
    withAllowlist(['sonnet'])
    expect(isModelAllowed('claude-sonnet-4-5@20250929')).toBe(true)
  })

  test('Vertex model with @date suffix allowed when canonical name is in allowlist', () => {
    withAllowlist(['claude-sonnet-4-5'])
    expect(isModelAllowed('claude-sonnet-4-5@20250929')).toBe(true)
  })

  test('Vertex opus model allowed when opus family alias is in allowlist', () => {
    withAllowlist(['opus'])
    expect(isModelAllowed('claude-opus-4-5@20251101')).toBe(true)
  })

  test('Vertex haiku model allowed by version-prefix entry', () => {
    withAllowlist(['claude-haiku-4-5'])
    expect(isModelAllowed('claude-haiku-4-5@20251001')).toBe(true)
  })

  test('Vertex model blocked when different family is in allowlist', () => {
    withAllowlist(['opus'])
    expect(isModelAllowed('claude-sonnet-4-5@20250929')).toBe(false)
  })

  test('custom model with @date suffix is NOT normalized — not accidentally allowed', () => {
    // A non-Claude model with @date suffix should not be normalized
    withAllowlist(['claude-sonnet-4-5'])
    expect(isModelAllowed('my-model@20250929')).toBe(false)
  })

  test('Vertex model not allowed when specific version restricts the family alias', () => {
    // ["opus", "opus-4-5"] → family wildcard suppressed, only opus 4.5 allowed
    withAllowlist(['opus', 'opus-4-5'])
    expect(isModelAllowed('claude-opus-4-6@20250929')).toBe(false) // opus 4.6 blocked
  })
})

describe('isModelAllowed — alias resolution', () => {
  test('"sonnet" alias is allowed when "sonnet" is in allowlist', () => {
    withAllowlist(['sonnet'])
    expect(isModelAllowed('sonnet')).toBe(true)
  })

  test('"opus" alias is allowed when "opus" is in allowlist', () => {
    withAllowlist(['opus'])
    expect(isModelAllowed('opus')).toBe(true)
  })

  test('"haiku" alias is blocked when only "sonnet" is in allowlist', () => {
    withAllowlist(['sonnet'])
    expect(isModelAllowed('haiku')).toBe(false)
  })

  test('alias is blocked when no entries in the allowlist match it', () => {
    // Use a concrete model ID that no alias will resolve to
    withAllowlist(['claude-haiku-4-5'])
    expect(isModelAllowed('opus')).toBe(false)
  })
})

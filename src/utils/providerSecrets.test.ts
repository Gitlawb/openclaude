import { describe, expect, test } from 'bun:test'

import {
  redactSecretValueForDisplay,
  sanitizeProviderConfigValue,
} from './providerSecrets.js'

describe('providerSecrets LLMTR coverage', () => {
  // A bare LLMTR key has no sk-/AIza prefix, so it is only recognised as a
  // secret when LLMTR_API_KEY is part of the shared SECRET_ENV_KEYS list.
  // Obviously-fake, low-entropy fixture so leak scanners don't flag it
  // (must be >8 chars so maskSecretForDisplay masks rather than returns
  // 'configured').
  const llmtrKey = 'fake-llmtr-test-key'

  test('sanitizeProviderConfigValue drops a poisoned field carrying the LLMTR key', () => {
    expect(
      sanitizeProviderConfigValue(llmtrKey, { LLMTR_API_KEY: llmtrKey }),
    ).toBeUndefined()
  })

  test('sanitizeProviderConfigValue keeps unrelated config values', () => {
    expect(
      sanitizeProviderConfigValue('llmtr/gemma-4', { LLMTR_API_KEY: llmtrKey }),
    ).toBe('llmtr/gemma-4')
  })

  test('redactSecretValueForDisplay masks the LLMTR key', () => {
    const redacted = redactSecretValueForDisplay(llmtrKey, {
      LLMTR_API_KEY: llmtrKey,
    })
    expect(redacted).not.toBe(llmtrKey)
    expect(redacted).toContain('...')
  })
})

import { describe, expect, test } from 'bun:test'

import {
  redactSecretValueForDisplay,
  sanitizeProviderConfigValue,
} from './providerSecrets.js'

describe('providerSecrets LLMTR coverage', () => {
  // A bare LLMTR key has no sk-/AIza prefix, so it is only recognised as a
  // secret when LLMTR_API_KEY is part of the shared SECRET_ENV_KEYS list.
  const llmtrKey = 'llmtr-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

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

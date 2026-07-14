import { describe, expect, test } from 'bun:test'
import { isFirstPartyAnthropicBaseUrlForEnv } from './anthropicBaseUrl.js'

describe('isFirstPartyAnthropicBaseUrlForEnv', () => {
  test('accepts the canonical HTTPS endpoint with its explicit default port', () => {
    expect(
      isFirstPartyAnthropicBaseUrlForEnv({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com:443',
      }),
    ).toBe(true)
  })
})

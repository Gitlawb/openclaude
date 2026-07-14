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

  test('rejects a non-default port on an Anthropic host', () => {
    expect(
      isFirstPartyAnthropicBaseUrlForEnv({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com:444',
      }),
    ).toBe(false)
  })

  test('defaults to true when ANTHROPIC_BASE_URL is unset', () => {
    expect(isFirstPartyAnthropicBaseUrlForEnv({})).toBe(true)
  })

  test('rejects non-HTTPS URLs and lookalike hosts', () => {
    expect(
      isFirstPartyAnthropicBaseUrlForEnv({
        ANTHROPIC_BASE_URL: 'http://api.anthropic.com',
      }),
    ).toBe(false)
    expect(
      isFirstPartyAnthropicBaseUrlForEnv({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com.evil.example',
      }),
    ).toBe(false)
  })

  test('only accepts the staging host for ant users', () => {
    expect(
      isFirstPartyAnthropicBaseUrlForEnv({
        ANTHROPIC_BASE_URL: 'https://api-staging.anthropic.com',
      }),
    ).toBe(false)
    expect(
      isFirstPartyAnthropicBaseUrlForEnv({
        ANTHROPIC_BASE_URL: 'https://api-staging.anthropic.com',
        USER_TYPE: 'ant',
      }),
    ).toBe(true)
  })

  test('fails closed for malformed URLs', () => {
    expect(
      isFirstPartyAnthropicBaseUrlForEnv({ ANTHROPIC_BASE_URL: 'not a URL' }),
    ).toBe(false)
  })
})

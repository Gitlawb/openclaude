import { describe, expect, test } from 'bun:test'

import { getEnvProviderOption } from './envProviderOption.js'

// Secret-disclosure regression coverage: OPENAI_BASE_URL / OPENAI_API_BASE
// are credential-bearing in the wild, and everything the onboarding option
// renders lands in terminal scrollback. displayBaseUrl must never carry the
// secret; baseUrl must stay intact so the saved profile still works.

describe('getEnvProviderOption — credential redaction', () => {
  test('URL userinfo is redacted for display but preserved for the profile', () => {
    const raw = 'https://svc-user:sup3r-s3cret@api.example.com/v1'
    const option = getEnvProviderOption({
      OPENAI_BASE_URL: raw,
      OPENAI_MODEL: 'gpt-4o',
    })

    expect(option.displayBaseUrl).not.toContain('sup3r-s3cret')
    expect(option.displayBaseUrl).not.toContain('svc-user')
    expect(option.displayBaseUrl).toContain('api.example.com')
    // The working URL is untouched — the profile must still authenticate.
    expect(option.baseUrl).toBe(raw)
    expect(option.available).toBe(true)
  })

  test('sensitive query parameters are redacted for display', () => {
    const raw = 'https://api.example.com/v1?token=abcd1234secret&api_key=zzz9999'
    const option = getEnvProviderOption({
      OPENAI_BASE_URL: raw,
      OPENAI_MODEL: 'gpt-4o',
    })

    expect(option.displayBaseUrl).not.toContain('abcd1234secret')
    expect(option.displayBaseUrl).not.toContain('zzz9999')
    expect(option.displayBaseUrl).toContain('api.example.com')
    expect(option.baseUrl).toBe(raw)
  })

  test('a credential-bearing OPENAI_API_BASE is redacted and named correctly', () => {
    const raw = 'https://user:pass@gateway.internal:8443/v1'
    const option = getEnvProviderOption({
      OPENAI_API_BASE: raw,
      OPENAI_MODEL: 'llama3',
    })

    expect(option.varName).toBe('OPENAI_API_BASE')
    expect(option.displayBaseUrl).not.toContain('pass')
    expect(option.baseUrl).toBe(raw)
  })

  test('a plain endpoint passes through unchanged', () => {
    const option = getEnvProviderOption({
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'llama3',
    })
    expect(option.displayBaseUrl).toContain('localhost:11434')
    expect(option.varName).toBe('OPENAI_BASE_URL')
  })

  test('a malformed endpoint still does not leak userinfo', () => {
    // redactUrlForDisplay has a non-URL fallback path; the option must not
    // regress to echoing the raw string when parsing fails.
    const option = getEnvProviderOption({
      OPENAI_BASE_URL: 'not a url://user:secret-pw@host/v1',
      OPENAI_MODEL: 'gpt-4o',
    })
    expect(option.displayBaseUrl).not.toContain('secret-pw')
  })
})

describe('getEnvProviderOption — availability and var naming', () => {
  test('OPENAI_BASE_URL wins over OPENAI_API_BASE and is named as such', () => {
    const option = getEnvProviderOption({
      OPENAI_BASE_URL: 'https://primary.example.com/v1',
      OPENAI_API_BASE: 'https://fallback.example.com/v1',
      OPENAI_MODEL: 'gpt-4o',
    })
    expect(option.baseUrl).toBe('https://primary.example.com/v1')
    expect(option.varName).toBe('OPENAI_BASE_URL')
  })

  test('a profile needs both a base URL and a model', () => {
    expect(
      getEnvProviderOption({ OPENAI_BASE_URL: 'https://x.example/v1' }).available,
    ).toBe(false)
    expect(getEnvProviderOption({ OPENAI_MODEL: 'gpt-4o' }).available).toBe(false)
    expect(getEnvProviderOption({}).available).toBe(false)
  })
})

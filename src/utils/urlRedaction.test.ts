import { describe, expect, test } from 'bun:test'

import {
  redactUrlForDisplay,
  shouldRedactUrlQueryParam,
} from './urlRedaction.ts'

describe('redactUrlForDisplay', () => {
  test('redacts credentials and sensitive query params for valid URLs', () => {
    const redacted = redactUrlForDisplay(
      'http://user:pass@localhost:11434/v1?api_key=secret&foo=bar',
    )

    expect(redacted).toBe(
      'http://redacted:redacted@localhost:11434/v1?api_key=redacted&foo=bar',
    )
  })

  test('redacts token-like query parameter names', () => {
    const redacted = redactUrlForDisplay(
      'https://example.com/v1?x_access_token=abc123&model=qwen2.5-coder',
    )

    expect(redacted).toBe(
      'https://example.com/v1?x_access_token=redacted&model=qwen2.5-coder',
    )
  })

  test('falls back to regex redaction for malformed URLs', () => {
    const redacted = redactUrlForDisplay(
      '//user:pass@localhost:11434?token=abc&mode=test',
    )

    expect(redacted).toBe('//redacted@localhost:11434?token=redacted&mode=test')
  })

  test('keeps non-sensitive URLs unchanged', () => {
    const url = 'http://localhost:11434/v1?model=llama3.1:8b'
    expect(redactUrlForDisplay(url)).toBe(url)
  })

  // Regression: the openaiShim copy of this list dropped these four names,
  // so `?passwd=…`, `?pwd=…`, `?auth=…`, `?apikey=…` (the no-underscore
  // form) were leaking into self-heal/error diagnostic logs (#1069). Pin
  // them here so any future fork of the list trips the test instead of
  // silently regressing.
  test('redacts passwd / pwd / auth / apikey variants', () => {
    expect(
      redactUrlForDisplay('https://api.example.com/v1?passwd=hunter2'),
    ).toBe('https://api.example.com/v1?passwd=redacted')
    expect(
      redactUrlForDisplay('https://api.example.com/v1?pwd=hunter2'),
    ).toBe('https://api.example.com/v1?pwd=redacted')
    expect(
      redactUrlForDisplay('https://api.example.com/v1?auth=Bearer-XYZ'),
    ).toBe('https://api.example.com/v1?auth=redacted')
    expect(
      redactUrlForDisplay('https://api.example.com/v1?apikey=sk-abc'),
    ).toBe('https://api.example.com/v1?apikey=redacted')
  })
})

describe('shouldRedactUrlQueryParam', () => {
  test('catches the canonical credential param names', () => {
    for (const name of [
      'api_key',
      'apikey',
      'api-key',
      'key',
      'token',
      'access_token',
      'access-token',
      'refresh_token',
      'signature',
      'sig',
      'secret',
      'password',
      'passwd',
      'pwd',
      'auth',
      'authorization',
    ]) {
      expect(shouldRedactUrlQueryParam(name)).toBe(true)
    }
  })

  test('does not flag unrelated param names', () => {
    for (const name of ['model', 'temperature', 'foo', 'session_id', 'user_id']) {
      expect(shouldRedactUrlQueryParam(name)).toBe(false)
    }
  })
})
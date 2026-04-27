import { describe, expect, test } from 'bun:test'

import { redactUrlForDisplay } from './urlRedaction.ts'

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
})
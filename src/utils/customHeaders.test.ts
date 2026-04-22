import { expect, test } from 'bun:test'

import {
  findBlockedCustomHeaderNames,
  formatCustomHeadersEnv,
  formatCustomHeadersInput,
  hasCustomAuthHeader,
  parseOpenAICompatibleCustomHeadersEnv,
  parseCustomHeadersEnv,
  parseCustomHeadersInput,
  redactHeadersForDisplay,
  sanitizeCustomHeaders,
} from './customHeaders.ts'

test('hasCustomAuthHeader recognizes known auth header names', () => {
  expect(
    hasCustomAuthHeader({
      'api-key': 'provider-api-key',
      'X-Org': 'demo-team',
    }),
  ).toBe(true)
})

test('hasCustomAuthHeader ignores non-auth header names even if values look like API keys', () => {
  expect(
    hasCustomAuthHeader({
      'X-Custom-Secret': 'sk-live',
      'X-Org': 'demo-team',
    }),
  ).toBe(false)
})

test('parseCustomHeadersEnv preserves semicolons inside header values', () => {
  expect(
    parseCustomHeadersEnv('X-Session-ID: abc;def;ghi\nX-App: cli'),
  ).toEqual({
    'X-Session-ID': 'abc;def;ghi',
    'X-App': 'cli',
  })
})

test('parseCustomHeadersEnv preserves very long header values', () => {
  const longValue = 'v'.repeat(16_384)

  expect(
    parseCustomHeadersEnv(`X-Long-Value: ${longValue}`),
  ).toEqual({
    'X-Long-Value': longValue,
  })
})

test('parseCustomHeadersEnv preserves Unicode header names and values', () => {
  expect(
    parseCustomHeadersEnv('X-Äuth: värde'),
  ).toEqual({
    'X-Äuth': 'värde',
  })
})

test('parseOpenAICompatibleCustomHeadersEnv supports semicolon and newline separators', () => {
  expect(
    parseOpenAICompatibleCustomHeadersEnv('api-key: one;X-Org: team-a; Foo: bar\nX-App: cli'),
  ).toEqual({
    'api-key': 'one',
    'X-Org': 'team-a',
    Foo: 'bar',
    'X-App': 'cli',
  })
})

test('parseOpenAICompatibleCustomHeadersEnv preserves semicolons inside unquoted values', () => {
  expect(
    parseOpenAICompatibleCustomHeadersEnv('X-Session-ID: abc;def;ghi'),
  ).toEqual({
    'X-Session-ID': 'abc;def;ghi',
  })
})

test('parseOpenAICompatibleCustomHeadersEnv does not split header-like substrings inside values', () => {
  expect(
    parseOpenAICompatibleCustomHeadersEnv('X-Test: abc;foo:bar'),
  ).toEqual({
    'X-Test': 'abc;foo:bar',
  })
  expect(
    parseOpenAICompatibleCustomHeadersEnv('X-Test: abc; foo:bar'),
  ).toEqual({
    'X-Test': 'abc; foo:bar',
  })
  expect(
    parseOpenAICompatibleCustomHeadersEnv('X-Test: abc;def:ghi'),
  ).toEqual({
    'X-Test': 'abc;def:ghi',
  })
  expect(
    parseOpenAICompatibleCustomHeadersEnv('X-Test: abc; Foo:bar'),
  ).toEqual({
    'X-Test': 'abc; Foo:bar',
  })
})

test('parseOpenAICompatibleCustomHeadersEnv splits generic name value pairs with or without space after semicolon', () => {
  expect(
    parseOpenAICompatibleCustomHeadersEnv('api-key: one;Org: team-a; Foo: bar'),
  ).toEqual({
    'api-key': 'one',
    Org: 'team-a',
    Foo: 'bar',
  })
})

test('parseOpenAICompatibleCustomHeadersEnv unquotes special values from env formatting', () => {
  expect(
    parseOpenAICompatibleCustomHeadersEnv('X-Session-ID: "abc;def;ghi"'),
  ).toEqual({
    'X-Session-ID': 'abc;def;ghi',
  })
})

test('parseCustomHeadersEnv preserves literal quoted values', () => {
  expect(
    parseCustomHeadersEnv('X-Test: "quoted"'),
  ).toEqual({
    'X-Test': '"quoted"',
  })
})

test('parseCustomHeadersEnv reports malformed and blocked env entries through warnings', () => {
  const warnings: string[] = []

  expect(
    parseCustomHeadersEnv(
      'api-key secret\nContent-Type: text/plain\nX-App: cli\n: missing-name\nX-Empty:',
      {
        sourceName: 'OPENAI_CUSTOM_HEADERS',
        onWarning: warning => {
          warnings.push(warning)
        },
      },
    ),
  ).toEqual({
    'X-App': 'cli',
  })

  expect(warnings).toEqual([
    'Ignoring malformed OPENAI_CUSTOM_HEADERS entry "api-key secret". Use "Name: value".',
    'Ignoring malformed OPENAI_CUSTOM_HEADERS entry ": missing-name". Header name is required.',
    'Ignoring malformed OPENAI_CUSTOM_HEADERS entry "X-Empty:". Header value is required.',
    'Ignoring blocked OPENAI_CUSTOM_HEADERS names: Content-Type.',
  ])
})

test('parseCustomHeadersEnv drops blocked header names', () => {
  expect(
    parseCustomHeadersEnv('Content-Type: text/plain\nX-App: cli'),
  ).toEqual({
    'X-App': 'cli',
  })
})

test('sanitizeCustomHeaders drops blocked header names', () => {
  expect(
    sanitizeCustomHeaders({
      'Content-Type': 'text/plain',
      Host: 'evil.test',
      'X-App': 'cli',
    }),
  ).toEqual({
    'X-App': 'cli',
  })
})

test('findBlockedCustomHeaderNames reports blocked names with original casing', () => {
  expect(
    findBlockedCustomHeaderNames({
      Host: 'evil.test',
      'content-type': 'text/plain',
      'X-App': 'cli',
    }),
  ).toEqual(['Host', 'content-type'])
})

test('parseCustomHeadersInput reports malformed and blocked entries', () => {
  expect(
    parseCustomHeadersInput('api-key secret; Content-Type: text/plain; X-App: cli'),
  ).toEqual({
    headers: {
      'X-App': 'cli',
    },
    errors: [
      'Malformed header entry "api-key secret". Use "Name: value".',
      'Blocked header names are not allowed: Content-Type.',
    ],
  })
})

test('formatCustomHeadersInput and parseCustomHeadersInput round-trip semicolon values', () => {
  const formatted = formatCustomHeadersInput({
    'X-Session-ID': 'abc;def;ghi',
    'X-Provider-Org': 'demo-team',
  })

  expect(formatted).toBe('X-Session-ID: "abc;def;ghi"; X-Provider-Org: demo-team')
  expect(parseCustomHeadersInput(formatted)).toEqual({
    headers: {
      'X-Session-ID': 'abc;def;ghi',
      'X-Provider-Org': 'demo-team',
    },
    errors: [],
  })
})

test('formatCustomHeadersEnv quotes semicolon values for safe round-tripping', () => {
  expect(
    formatCustomHeadersEnv({
      'X-Session-ID': 'abc;def;ghi',
      'X-Provider-Org': 'demo-team',
    }),
  ).toBe('X-Session-ID: "abc;def;ghi"\nX-Provider-Org: demo-team')
})

test('parseCustomHeadersInput reports empty header names and values', () => {
  expect(
    parseCustomHeadersInput('api-key: ; : secret; X-App: ok'),
  ).toEqual({
    headers: {
      'X-App': 'ok',
    },
    errors: [
      'Malformed header entry "api-key:". Header value is required.',
      'Malformed header entry ": secret". Header name is required.',
    ],
  })
})

test('redactHeadersForDisplay redacts all header values', () => {
  expect(
    redactHeadersForDisplay({
      'api-key': 'provider-api-key',
      'X-Provider-Org': 'demo-team',
    }),
  ).toEqual({
    'api-key': '***REDACTED***',
    'X-Provider-Org': '***REDACTED***',
  })
})

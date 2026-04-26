import { describe, expect, test } from 'bun:test'

import {
  parseProfileCustomHeadersInput,
  serializeProfileCustomHeaders,
} from './providerCustomHeaders.js'

describe('parseProfileCustomHeadersInput', () => {
  test('accepts semicolon and newline separated custom headers', () => {
    expect(
      parseProfileCustomHeadersInput('X-Team: devtools; api-key: provider-key\nX-Env: test'),
    ).toEqual({
      headers: {
        'X-Team': 'devtools',
        'api-key': 'provider-key',
        'X-Env': 'test',
      },
    })
  })

  test('rejects malformed and unsafe header names', () => {
    expect(parseProfileCustomHeadersInput('Not A Header')).toMatchObject({
      error: expect.stringContaining('Name: value'),
    })
    expect(parseProfileCustomHeadersInput('Authorization: Bearer token')).toMatchObject({
      error: expect.stringContaining('managed by OpenClaude'),
    })
    expect(parseProfileCustomHeadersInput('x-api-key: token')).toMatchObject({
      error: expect.stringContaining('managed by OpenClaude'),
    })
    expect(parseProfileCustomHeadersInput('x-anthropic-danger: yes')).toMatchObject({
      error: expect.stringContaining('managed by OpenClaude'),
    })
  })
})

describe('serializeProfileCustomHeaders', () => {
  test('serializes profile headers for ANTHROPIC_CUSTOM_HEADERS', () => {
    expect(
      serializeProfileCustomHeaders({
        'X-Team': 'devtools',
        'X-Trace': 'enabled',
      }),
    ).toBe('X-Team: devtools\nX-Trace: enabled')
  })
})

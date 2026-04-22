import { expect, test } from 'bun:test'

import {
  hasCustomAuthHeader,
  parseCustomHeadersEnv,
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

test('parseCustomHeadersEnv supports semicolon and newline separators', () => {
  expect(
    parseCustomHeadersEnv('api-key: one; X-Org: team-a\nX-App: cli'),
  ).toEqual({
    'api-key': 'one',
    'X-Org': 'team-a',
    'X-App': 'cli',
  })
})

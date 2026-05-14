import { expect, test } from 'bun:test'

import {
  DEFAULT_CODEX_OAUTH_CALLBACK_HOST,
  DEFAULT_CODEX_OAUTH_CALLBACK_PORT,
  getCodexOAuthCallbackHost,
  getCodexOAuthCallbackPort,
} from './codexOAuthShared.js'

test('getCodexOAuthCallbackPort falls back for zero', () => {
  expect(
    getCodexOAuthCallbackPort({
      CODEX_OAUTH_CALLBACK_PORT: '0',
    } as NodeJS.ProcessEnv),
  ).toBe(DEFAULT_CODEX_OAUTH_CALLBACK_PORT)
})

test('getCodexOAuthCallbackPort falls back for invalid values', () => {
  expect(
    getCodexOAuthCallbackPort({
      CODEX_OAUTH_CALLBACK_PORT: '-1',
    } as NodeJS.ProcessEnv),
  ).toBe(DEFAULT_CODEX_OAUTH_CALLBACK_PORT)
})

test('getCodexOAuthCallbackHost only accepts loopback hosts', () => {
  expect(
    getCodexOAuthCallbackHost({
      CODEX_OAUTH_CALLBACK_HOST: '127.0.0.1',
    } as NodeJS.ProcessEnv),
  ).toBe('127.0.0.1')

  expect(
    getCodexOAuthCallbackHost({
      CODEX_OAUTH_CALLBACK_HOST: 'example.com',
    } as NodeJS.ProcessEnv),
  ).toBe(DEFAULT_CODEX_OAUTH_CALLBACK_HOST)
})

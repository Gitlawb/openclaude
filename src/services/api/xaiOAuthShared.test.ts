import { describe, expect, test } from 'bun:test'

import {
  asTrimmedString,
  decodeJwtPayload,
  DEFAULT_XAI_OAUTH_CALLBACK_HOST,
  DEFAULT_XAI_OAUTH_CALLBACK_PORT,
  DEFAULT_XAI_OAUTH_CLIENT_ID,
  deriveExpiresMsFromJwt,
  escapeHtml,
  getXaiOAuthCallbackHost,
  getXaiOAuthCallbackPort,
  getXaiOAuthClientId,
  getXaiOAuthRedirectUri,
  isTrustedXaiOAuthEndpoint,
  requireTrustedXaiOAuthEndpoint,
  XAI_OAUTH_CALLBACK_PATH,
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_ISSUER,
} from './xaiOAuthShared.js'

describe('xaiOAuthShared', () => {
  test('uses the openclaw-published shared client_id by default', () => {
    expect(getXaiOAuthClientId({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_XAI_OAUTH_CLIENT_ID,
    )
  })

  test('honours XAI_OAUTH_CLIENT_ID override', () => {
    expect(
      getXaiOAuthClientId({
        XAI_OAUTH_CLIENT_ID: '  custom-client  ',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe('custom-client')
  })

  test('clamps callback port to a valid range and falls back on garbage', () => {
    expect(getXaiOAuthCallbackPort({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_XAI_OAUTH_CALLBACK_PORT,
    )
    expect(
      getXaiOAuthCallbackPort({
        XAI_OAUTH_CALLBACK_PORT: '70000',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(DEFAULT_XAI_OAUTH_CALLBACK_PORT)
    expect(
      getXaiOAuthCallbackPort({
        XAI_OAUTH_CALLBACK_PORT: '9999',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(9999)
  })

  test('only accepts loopback hosts', () => {
    expect(getXaiOAuthCallbackHost({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_XAI_OAUTH_CALLBACK_HOST,
    )
    expect(
      getXaiOAuthCallbackHost({
        XAI_OAUTH_CALLBACK_HOST: 'evil.example.com',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(DEFAULT_XAI_OAUTH_CALLBACK_HOST)
    expect(
      getXaiOAuthCallbackHost({
        XAI_OAUTH_CALLBACK_HOST: 'localhost',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe('localhost')
  })

  test('redirect URI uses the callback path', () => {
    const uri = getXaiOAuthRedirectUri({} as NodeJS.ProcessEnv)
    expect(uri).toBe(
      `http://${DEFAULT_XAI_OAUTH_CALLBACK_HOST}:${DEFAULT_XAI_OAUTH_CALLBACK_PORT}${XAI_OAUTH_CALLBACK_PATH}`,
    )
  })

  test('isTrustedXaiOAuthEndpoint requires https x.ai hosts', () => {
    expect(isTrustedXaiOAuthEndpoint(`${XAI_OAUTH_ISSUER}/oauth/token`)).toBe(
      true,
    )
    expect(isTrustedXaiOAuthEndpoint('https://accounts.x.ai/login')).toBe(true)
    // http (not https)
    expect(isTrustedXaiOAuthEndpoint('http://auth.x.ai/oauth/token')).toBe(
      false,
    )
    // attacker-controlled host that just contains x.ai
    expect(
      isTrustedXaiOAuthEndpoint('https://auth.x.ai.evil.example.com/token'),
    ).toBe(false)
    expect(isTrustedXaiOAuthEndpoint('not-a-url')).toBe(false)
  })

  test('requireTrustedXaiOAuthEndpoint throws on untrusted host', () => {
    expect(() =>
      requireTrustedXaiOAuthEndpoint(
        'https://attacker.example.com/oauth/token',
        'token endpoint',
      ),
    ).toThrow(/untrusted token endpoint/)
    expect(
      requireTrustedXaiOAuthEndpoint(
        'https://auth.x.ai/oauth/token',
        'token endpoint',
      ),
    ).toBe('https://auth.x.ai/oauth/token')
  })

  test('XAI_OAUTH_DISCOVERY_URL points at the issuer well-known', () => {
    expect(XAI_OAUTH_DISCOVERY_URL).toBe(
      `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`,
    )
  })

  test('decodeJwtPayload returns the JSON payload', () => {
    const header = Buffer.from('{"alg":"none"}').toString('base64url')
    const payload = Buffer.from('{"sub":"abc","exp":12345}').toString(
      'base64url',
    )
    const token = `${header}.${payload}.`
    expect(decodeJwtPayload(token)).toEqual({ sub: 'abc', exp: 12345 })
  })

  test('decodeJwtPayload tolerates garbage', () => {
    expect(decodeJwtPayload(undefined)).toBeUndefined()
    expect(decodeJwtPayload('not-a-jwt')).toBeUndefined()
  })

  test('deriveExpiresMsFromJwt converts exp seconds to ms', () => {
    const payload = Buffer.from('{"exp":1700000000}').toString('base64url')
    const token = `header.${payload}.`
    expect(deriveExpiresMsFromJwt(token)).toBe(1700000000_000)
  })

  test('asTrimmedString filters empty / non-string', () => {
    expect(asTrimmedString('  hello  ')).toBe('hello')
    expect(asTrimmedString('   ')).toBeUndefined()
    expect(asTrimmedString(123)).toBeUndefined()
    expect(asTrimmedString(undefined)).toBeUndefined()
  })

  test('escapeHtml escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})

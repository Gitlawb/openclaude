import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  isCanonicalAimlapiInferenceBaseUrl,
  resolveAimlapiAttributionHeaders,
  resolvePartnerId,
  resolveEndpoints,
  withResolvedPartnerHeader,
} from './config.js'

const envNames = [
  'AIMLAPI_AUTH_URL',
  'AIMLAPI_APP_URL',
  'AIMLAPI_INFERENCE_URL',
  'AIMLAPI_PARTNER_ID',
] as const
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))

// Clear ambient AIMLAPI overrides before every test so default/fallback
// assertions never depend on the invoking environment; the runner's original
// values are restored in teardown.
beforeEach(() => {
  for (const name of envNames) delete process.env[name]
})

afterEach(() => {
  for (const name of envNames) {
    const value = originalEnv[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('resolveEndpoints returns the production endpoints', () => {
  expect(resolveEndpoints()).toEqual({
    authBaseUrl: 'https://auth.aimlapi.com',
    appBaseUrl: 'https://app.aimlapi.com',
    payBaseUrl: 'https://pay.aimlapi.com',
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    verificationBaseUrl: 'https://aimlapi.com/app',
  })
})

test('partner id is fixed and ignores the env override', () => {
  process.env.AIMLAPI_PARTNER_ID = 'part_override'
  // The partner id is locked to OpenClaude's attribution id; an env override is
  // intentionally ignored so rebate attribution can never be redirected.
  expect(resolvePartnerId()).toBe('part_62yQoGYDq4Yqnrj2R1iGrDNJ')
  expect(
    withResolvedPartnerHeader({
      'x-aimlapi-partner-id': 'part_catalog',
      'X-Title': 'OpenClaude',
    }),
  ).toEqual({
    'X-AIMLAPI-Partner-ID': 'part_62yQoGYDq4Yqnrj2R1iGrDNJ',
    'X-Title': 'OpenClaude',
  })
})

test('canonical endpoint check excludes proxies and look-alike paths', () => {
  // Exactly the production endpoint, with at most one trailing slash.
  expect(isCanonicalAimlapiInferenceBaseUrl('https://api.aimlapi.com/v1')).toBe(true)
  expect(isCanonicalAimlapiInferenceBaseUrl('https://api.aimlapi.com/v1/')).toBe(true)
  // Host/protocol compare case-insensitively via the parsed origin.
  expect(isCanonicalAimlapiInferenceBaseUrl('https://API.AIMLAPI.COM/v1')).toBe(true)

  // Distinct paths must NOT receive the ambient credential.
  expect(isCanonicalAimlapiInferenceBaseUrl('https://api.aimlapi.com/V1')).toBe(false)
  expect(isCanonicalAimlapiInferenceBaseUrl('https://api.aimlapi.com/v1////')).toBe(false)
  expect(isCanonicalAimlapiInferenceBaseUrl('https://api.aimlapi.com/v1/models')).toBe(false)
  // A different protocol/host is never canonical.
  expect(isCanonicalAimlapiInferenceBaseUrl('http://api.aimlapi.com/v1')).toBe(false)
  expect(isCanonicalAimlapiInferenceBaseUrl('https://proxy.example.test/v1')).toBe(false)
  // Garbage input fails closed.
  expect(isCanonicalAimlapiInferenceBaseUrl('not-a-url')).toBe(false)
})

test('inference/catalog attribution sends both mandatory headers, stripped off-canonical', () => {
  const canonical = resolveAimlapiAttributionHeaders({}, 'https://api.aimlapi.com/v1')
  expect(canonical['X-AIMLAPI-Source']).toBe('agent/openclaude')
  expect(canonical['X-AIMLAPI-Partner-ID']).toBe('part_62yQoGYDq4Yqnrj2R1iGrDNJ')

  // A user proxy must never receive OpenClaude's partner identity or source.
  const proxied = resolveAimlapiAttributionHeaders(
    { 'X-AIMLAPI-Source': 'agent/openclaude', 'X-AIMLAPI-Partner-ID': 'part_x' },
    'https://proxy.example.test/v1',
  )
  expect(proxied['X-AIMLAPI-Source']).toBeUndefined()
  expect(proxied['X-AIMLAPI-Partner-ID']).toBeUndefined()
})

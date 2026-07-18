import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  isCanonicalAimlapiInferenceBaseUrl,
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
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
  })
})

test('partner id override is shared with the inference header', () => {
  process.env.AIMLAPI_PARTNER_ID = 'part_override'
  expect(resolvePartnerId()).toBe('part_override')
  expect(
    withResolvedPartnerHeader({
      'x-aimlapi-partner-id': 'part_catalog',
      'X-Title': 'OpenClaude',
    }),
  ).toEqual({
    'X-AIMLAPI-Partner-ID': 'part_override',
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

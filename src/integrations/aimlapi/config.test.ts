import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  buildPartnerCheckoutReturnUrls,
  buildPartnerReturnUrl,
  isCanonicalAimlapiInferenceBaseUrl,
  resolvePartnerId,
  resolveEndpoints,
  withResolvedPartnerHeader,
} from './config.js'

const envNames = [
  'AIMLAPI_AUTH_URL',
  'AIMLAPI_APP_URL',
  'AIMLAPI_INFERENCE_URL',
  'AIMLAPI_PAY_URL',
  'AIMLAPI_VERIFICATION_BASE_URL',
  'AIMLAPI_RETURN_URL',
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

test('resolveEndpoints returns the production passwordless and checkout endpoints', () => {
  for (const name of envNames) delete process.env[name]
  expect(resolveEndpoints()).toEqual({
    authBaseUrl: 'https://auth.aimlapi.com',
    appBaseUrl: 'https://app.aimlapi.com',
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    payBaseUrl: 'https://pay.aimlapi.com',
    verificationBaseUrl: 'https://aimlapi.com/app',
  })
})

test('checkout and browser return URLs stay in the selected environment', () => {
  expect(buildPartnerCheckoutReturnUrls('https://pay.example.test/', 'a/b')).toEqual({
    successUrl:
      'https://pay.example.test/checkout?checkout=success&partnerCheckout=1&sessionToken=a%2Fb',
    cancelUrl:
      'https://pay.example.test/checkout?checkout=cancel&partnerCheckout=1&sessionToken=a%2Fb',
  })
  expect(buildPartnerCheckoutReturnUrls('', 'token')).toEqual({})
  expect(buildPartnerReturnUrl('https://front.example.test/')).toBe(
    'https://front.example.test',
  )
})

test('AIMLAPI_RETURN_URL overrides the browser landing page', () => {
  process.env.AIMLAPI_RETURN_URL = 'https://return.example.test/done'
  expect(buildPartnerReturnUrl('https://front.example.test')).toBe(
    'https://return.example.test/done',
  )
})

test('unsafe checkout and return URL overrides are rejected', () => {
  expect(buildPartnerCheckoutReturnUrls('file:///tmp/pay', 'token')).toEqual({})
  expect(
    buildPartnerCheckoutReturnUrls('https://user:secret@pay.example.test', 'token'),
  ).toEqual({})
  expect(buildPartnerCheckoutReturnUrls('not a URL', 'token')).toEqual({})
  expect(buildPartnerCheckoutReturnUrls('http://pay.example.test', 'token')).toEqual(
    {},
  )
  expect(
    buildPartnerCheckoutReturnUrls('http://127.0.0.1.evil.example', 'token'),
  ).toEqual({})
  expect(
    buildPartnerCheckoutReturnUrls('https://pay.example.test?environment=test', 'token'),
  ).toEqual({})
  expect(
    buildPartnerCheckoutReturnUrls('https://pay.example.test/#checkout', 'token'),
  ).toEqual({})
  expect(buildPartnerCheckoutReturnUrls('http://127.0.0.1:3000/', 'token')).toEqual({
    successUrl:
      'http://127.0.0.1:3000/checkout?checkout=success&partnerCheckout=1&sessionToken=token',
    cancelUrl:
      'http://127.0.0.1:3000/checkout?checkout=cancel&partnerCheckout=1&sessionToken=token',
  })
  expect(buildPartnerReturnUrl('http://127.1:3000/')).toBe(
    'http://127.0.0.1:3000',
  )

  for (const override of [
    'file:///tmp/return',
    'https://user:secret@return.example.test',
    'http://return.example.test',
    'https://return.example.test/done?source=test',
    'https://return.example.test/done#checkout',
    'not a URL',
  ]) {
    process.env.AIMLAPI_RETURN_URL = override
    expect(buildPartnerReturnUrl('https://front.example.test/')).toBe(
      'https://front.example.test',
    )
  }
  process.env.AIMLAPI_RETURN_URL = 'javascript:alert(1)'
  expect(buildPartnerReturnUrl('also invalid')).toBe('https://aimlapi.com/app')
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

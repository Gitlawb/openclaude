import { expect, test } from 'bun:test'
import { isValidPemContent } from './upstreamproxy.ts'

// Finding #42-6: The CA cert downloaded from the upstream proxy is written
// to disk without validation. A compromised server could send arbitrary data.
// Fix: validate it contains only valid PEM certificate blocks before writing.

test('isValidPemContent returns true for a valid PEM certificate block', () => {
  const pem = [
    '-----BEGIN CERTIFICATE-----',
    'MIICpDCCAYwCCQDU+pQ4pHgSpDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls',
    'b2NhbGhvc3QwHhcNMjMwMTAxMDAwMDAwWhcNMjQwMTAxMDAwMDAwWjAUMRIwEAYD',
    'VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7',
    '-----END CERTIFICATE-----',
  ].join('\n')

  expect(isValidPemContent(pem)).toBe(true)
})

test('isValidPemContent returns true for multiple PEM blocks', () => {
  const block = '-----BEGIN CERTIFICATE-----\nABCD\n-----END CERTIFICATE-----'
  const pem = `${block}\n${block}`
  expect(isValidPemContent(pem)).toBe(true)
})

test('isValidPemContent returns false for arbitrary text', () => {
  expect(isValidPemContent('Hello world')).toBe(false)
  expect(isValidPemContent('<html><body>error</body></html>')).toBe(false)
  expect(isValidPemContent('{"error":"unauthorized"}')).toBe(false)
})

test('isValidPemContent returns false for empty string', () => {
  expect(isValidPemContent('')).toBe(false)
})

test('isValidPemContent returns false for whitespace only', () => {
  expect(isValidPemContent('   \n   ')).toBe(false)
})

test('isValidPemContent returns false for malformed PEM (no end marker)', () => {
  expect(isValidPemContent('-----BEGIN CERTIFICATE-----\nABCD')).toBe(false)
})

import { expect, test } from 'bun:test'
import { buildSdkUrl, isLocalhostBaseUrl } from './workSecret.ts'

// Regression coverage: buildSdkUrl must decide localhost from the parsed
// hostname only, not from "localhost" appearing elsewhere in the URL.

test('buildSdkUrl uses wss for remote URL that contains localhost in path', () => {
  const url = buildSdkUrl('https://remote.example.com/proxy/localhost/api', 'sess-1')
  expect(url).toContain('wss://')
  expect(url).not.toContain('ws://')
})

test('buildSdkUrl uses ws for actual localhost hostname', () => {
  const url = buildSdkUrl('http://localhost:8080', 'sess-1')
  expect(url).toContain('ws://')
})

test('buildSdkUrl uses ws for 127.0.0.1 hostname', () => {
  const url = buildSdkUrl('http://127.0.0.1:3000', 'sess-1')
  expect(url).toContain('ws://')
})

test('buildSdkUrl uses wss for regular remote hostname', () => {
  const url = buildSdkUrl('https://api.example.com', 'sess-1')
  expect(url).toContain('wss://')
})

test('buildSdkUrl uses v2 path for localhost', () => {
  const url = buildSdkUrl('http://localhost:8080', 'sess-abc')
  expect(url).toContain('/v2/session_ingress/ws/sess-abc')
})

test('buildSdkUrl uses v1 path for remote', () => {
  const url = buildSdkUrl('https://api.example.com', 'sess-abc')
  expect(url).toContain('/v1/session_ingress/ws/sess-abc')
})

// isLocalhostBaseUrl gates the HTTP-over-the-wire credential guard in
// bridgeMain. It must match the loopback hostname exactly, not anywhere the
// literal text "localhost"/"127.0.0.1" happens to appear in the URL.

test('isLocalhostBaseUrl: true for localhost hostname', () => {
  expect(isLocalhostBaseUrl('http://localhost:8080')).toBe(true)
})

test('isLocalhostBaseUrl: true for 127.0.0.1 hostname', () => {
  expect(isLocalhostBaseUrl('http://127.0.0.1:3000')).toBe(true)
})

test('isLocalhostBaseUrl: false when localhost is only in the path', () => {
  expect(isLocalhostBaseUrl('http://evil.example.com/localhost')).toBe(false)
})

test('isLocalhostBaseUrl: false for a domain that merely ends in localhost', () => {
  expect(isLocalhostBaseUrl('http://evil.localhost.com')).toBe(false)
})

test('isLocalhostBaseUrl: false when 127.0.0.1 is a label prefix of a remote host', () => {
  expect(isLocalhostBaseUrl('http://127.0.0.1.evil.com')).toBe(false)
})

test('isLocalhostBaseUrl: false for a regular remote hostname', () => {
  expect(isLocalhostBaseUrl('https://api.example.com')).toBe(false)
})

test('isLocalhostBaseUrl: false for a malformed URL', () => {
  expect(isLocalhostBaseUrl('not a url')).toBe(false)
})

import { expect, test } from 'bun:test'
import { buildSdkUrl } from './workSecret.ts'

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

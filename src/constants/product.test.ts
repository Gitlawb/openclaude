import { expect, test } from 'bun:test'

import {
  CLAUDE_AI_BASE_URL,
  CLAUDE_AI_LOCAL_BASE_URL,
  CLAUDE_AI_STAGING_BASE_URL,
  getClaudeAiBaseUrl,
  isRemoteSessionLocal,
  isRemoteSessionStaging,
} from './product.js'

// --- isRemoteSessionLocal ---

test('isRemoteSessionLocal: matches a localhost ingress hostname', () => {
  expect(isRemoteSessionLocal(undefined, 'http://localhost:4000')).toBe(true)
  expect(isRemoteSessionLocal(undefined, 'http://127.0.0.1:4000')).toBe(true)
})

test('isRemoteSessionLocal: matches a `_local_` session id', () => {
  expect(isRemoteSessionLocal('session_local_abc', undefined)).toBe(true)
})

test('isRemoteSessionLocal: does not match `localhost` in a production URL path or query', () => {
  // Regression: the old `ingressUrl.includes('localhost')` check would route
  // these production URLs to http://localhost:4000.
  expect(
    isRemoteSessionLocal(undefined, 'https://claude.ai/code/x?ref=localhost'),
  ).toBe(false)
  expect(
    isRemoteSessionLocal(undefined, 'https://localhost.attacker.example.com'),
  ).toBe(false)
  expect(
    isRemoteSessionLocal(undefined, 'https://my-localhost-proxy.example.com'),
  ).toBe(false)
})

test('isRemoteSessionLocal: false for missing or malformed ingress URL', () => {
  expect(isRemoteSessionLocal(undefined, undefined)).toBe(false)
  expect(isRemoteSessionLocal(undefined, 'not a url')).toBe(false)
})

// --- isRemoteSessionStaging ---

test('isRemoteSessionStaging: matches the staging ingress hostname label', () => {
  expect(
    isRemoteSessionStaging(undefined, 'https://claude-ai.staging.ant.dev'),
  ).toBe(true)
})

test('isRemoteSessionStaging: matches a `_staging_` session id', () => {
  expect(isRemoteSessionStaging('session_staging_abc', undefined)).toBe(true)
})

test('isRemoteSessionStaging: does not match `staging` in a production URL path or query', () => {
  // Regression: the old `ingressUrl.includes('staging')` check would route
  // these production URLs to the staging endpoint.
  expect(
    isRemoteSessionStaging(undefined, 'https://claude.ai/code/x?ref=staging'),
  ).toBe(false)
  expect(
    isRemoteSessionStaging(undefined, 'https://staging-cdn-claude.example.com'),
  ).toBe(false)
})

test('isRemoteSessionStaging: false for missing or malformed ingress URL', () => {
  expect(isRemoteSessionStaging(undefined, undefined)).toBe(false)
  expect(isRemoteSessionStaging(undefined, 'not a url')).toBe(false)
})

// --- getClaudeAiBaseUrl routing ---

test('getClaudeAiBaseUrl: production URL with `localhost`/`staging` substrings routes to prod', () => {
  expect(
    getClaudeAiBaseUrl(undefined, 'https://claude.ai/code/x?ref=localhost'),
  ).toBe(CLAUDE_AI_BASE_URL)
  expect(
    getClaudeAiBaseUrl(undefined, 'https://claude.ai/code/x?ref=staging'),
  ).toBe(CLAUDE_AI_BASE_URL)
})

test('getClaudeAiBaseUrl: routes real local/staging ingress hosts correctly', () => {
  expect(getClaudeAiBaseUrl(undefined, 'http://localhost:4000')).toBe(
    CLAUDE_AI_LOCAL_BASE_URL,
  )
  expect(
    getClaudeAiBaseUrl(undefined, 'https://claude-ai.staging.ant.dev'),
  ).toBe(CLAUDE_AI_STAGING_BASE_URL)
})

test('getClaudeAiBaseUrl: defaults to production with no hints', () => {
  expect(getClaudeAiBaseUrl(undefined, undefined)).toBe(CLAUDE_AI_BASE_URL)
})

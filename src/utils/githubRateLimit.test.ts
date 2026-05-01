import { afterEach, expect, test } from 'bun:test'

import {
  updateGithubRateLimit,
  getGithubRateLimitState,
  formatGithubRateLimitSummary,
  resetGithubRateLimitState,
} from './githubRateLimit.js'

afterEach(() => {
  resetGithubRateLimitState()
})

test('updateGithubRateLimit parses request and token limits', () => {
  const headers = new Headers({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '42',
    'x-ratelimit-limit-tokens': '500000',
    'x-ratelimit-remaining-tokens': '123456',
  })

  updateGithubRateLimit(headers)
  const state = getGithubRateLimitState()

  expect(state.limitRequests).toBe(100)
  expect(state.remainingRequests).toBe(42)
  expect(state.limitTokens).toBe(500000)
  expect(state.remainingTokens).toBe(123456)
})

test('updateGithubRateLimit parses epoch-seconds reset timestamp', () => {
  const epoch = Math.floor(Date.now() / 1000) + 3600
  const headers = new Headers({
    'x-ratelimit-reset-requests': String(epoch),
    'x-ratelimit-remaining-requests': '10',
  })

  updateGithubRateLimit(headers)
  const state = getGithubRateLimitState()

  expect(state.resetRequestsAt).not.toBeNull()
  expect(state.resetRequestsAt!.getTime()).toBe(epoch * 1000)
})

test('updateGithubRateLimit only updates present headers', () => {
  const headers = new Headers({
    'x-ratelimit-remaining-requests': '5',
  })

  updateGithubRateLimit(headers)
  const state = getGithubRateLimitState()

  expect(state.remainingRequests).toBe(5)
  expect(state.limitRequests).toBeNull()
  expect(state.limitTokens).toBeNull()
  expect(state.remainingTokens).toBeNull()
})

test('formatGithubRateLimitSummary returns null when no data', () => {
  expect(formatGithubRateLimitSummary()).toBeNull()
})

test('formatGithubRateLimitSummary formats requests and tokens', () => {
  const headers = new Headers({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '42',
    'x-ratelimit-limit-tokens': '500000',
    'x-ratelimit-remaining-tokens': '123456',
  })

  updateGithubRateLimit(headers)
  const summary = formatGithubRateLimitSummary()

  expect(summary).toContain('requests: 42/100 remaining')
  expect(summary).toContain('tokens: 123456/500000 remaining')
})

test('formatGithubRateLimitSummary handles partial data', () => {
  const headers = new Headers({
    'x-ratelimit-remaining-requests': '7',
  })

  updateGithubRateLimit(headers)
  const summary = formatGithubRateLimitSummary()

  expect(summary).toContain('requests remaining: 7')
  expect(summary).not.toContain('tokens')
})

test('resetGithubRateLimitState clears all data', () => {
  const headers = new Headers({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '42',
  })

  updateGithubRateLimit(headers)
  resetGithubRateLimitState()

  expect(getGithubRateLimitState().limitRequests).toBeNull()
  expect(getGithubRateLimitState().remainingRequests).toBeNull()
  expect(formatGithubRateLimitSummary()).toBeNull()
})

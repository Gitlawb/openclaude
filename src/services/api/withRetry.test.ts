import { describe, expect, test, afterEach, beforeEach } from 'bun:test'
import { getRateLimitResetDelayMs, parseOpenAIDuration } from './withRetry.js'
import { APIError } from '@anthropic-ai/sdk'

// Helper to build a mock APIError with specific headers
function makeError(headers: Record<string, string>): APIError {
  const headersObj = new Headers(headers)
  return {
    headers: headersObj,
    status: 429,
    message: 'rate limit exceeded',
    name: 'APIError',
    error: {},
  } as unknown as APIError
}

// Save original env vars before any mutation
const originalEnv = { ...process.env }

// Clear provider env before EACH test so the first test in every
// describe block also runs with a clean slate (not just between tests).
beforeEach(() => {
  for (const key of [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ]) {
    delete process.env[key]
  }
})

// Restore original env after each test
afterEach(() => {
  for (const key of [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ]) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

// --- parseOpenAIDuration ---
describe('parseOpenAIDuration', () => {
  test('parses seconds: "1s" → 1000', () => {
    expect(parseOpenAIDuration('1s')).toBe(1000)
  })

  test('parses minutes+seconds: "6m0s" → 360000', () => {
    expect(parseOpenAIDuration('6m0s')).toBe(360000)
  })

  test('parses hours+minutes+seconds: "1h30m0s" → 5400000', () => {
    expect(parseOpenAIDuration('1h30m0s')).toBe(5400000)
  })

  test('parses milliseconds: "500ms" → 500', () => {
    expect(parseOpenAIDuration('500ms')).toBe(500)
  })

  test('parses minutes only: "2m" → 120000', () => {
    expect(parseOpenAIDuration('2m')).toBe(120000)
  })

  test('returns null for empty string', () => {
    expect(parseOpenAIDuration('')).toBeNull()
  })

  test('returns null for unrecognized format', () => {
    expect(parseOpenAIDuration('invalid')).toBeNull()
  })
})

// --- getRateLimitResetDelayMs ---
describe('getRateLimitResetDelayMs - Anthropic (firstParty)', () => {
  test('reads anthropic-ratelimit-unified-reset Unix timestamp', () => {
    const futureUnixSec = Math.floor(Date.now() / 1000) + 60
    const error = makeError({
      'anthropic-ratelimit-unified-reset': String(futureUnixSec),
    })
    const delay = getRateLimitResetDelayMs(error)
    expect(delay).not.toBeNull()
    expect(delay!).toBeGreaterThan(50_000)
    expect(delay!).toBeLessThanOrEqual(60_000)
  })

  test('returns null when header absent', () => {
    const error = makeError({})
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })

  test('returns null when reset is in the past', () => {
    const pastUnixSec = Math.floor(Date.now() / 1000) - 10
    const error = makeError({
      'anthropic-ratelimit-unified-reset': String(pastUnixSec),
    })
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })
})

describe('getRateLimitResetDelayMs - OpenAI provider', () => {
  test('reads x-ratelimit-reset-requests duration string', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const error = makeError({ 'x-ratelimit-reset-requests': '30s' })
    const delay = getRateLimitResetDelayMs(error)
    expect(delay).toBe(30_000)
  })

  test('reads x-ratelimit-reset-tokens and picks the larger delay', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const error = makeError({
      'x-ratelimit-reset-requests': '10s',
      'x-ratelimit-reset-tokens': '1m0s',
    })
    // Should use the larger of the two so we don't retry before both reset
    const delay = getRateLimitResetDelayMs(error)
    expect(delay).toBe(60_000)
  })

  test('returns null when no openai rate limit headers present', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const error = makeError({})
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })

  test('works for github provider too', () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    const error = makeError({ 'x-ratelimit-reset-requests': '5s' })
    expect(getRateLimitResetDelayMs(error)).toBe(5_000)
  })
})

describe('getRateLimitResetDelayMs - providers without reset headers', () => {
  test('returns null for bedrock', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const error = makeError({ 'anthropic-ratelimit-unified-reset': String(Math.floor(Date.now() / 1000) + 60) })
    // Bedrock doesn't use this header — should still return null
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })

  test('returns null for vertex', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    const error = makeError({})
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })
})

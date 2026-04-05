import { afterEach, describe, expect, mock, test } from 'bun:test'
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

// Save/restore env vars between tests
const originalEnv = { ...process.env }
afterEach(() => {
  for (const key of [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_UNATTENDED_RETRY',
  ]) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  mock.restore()
})

async function importFreshWithRetryModule(
  provider:
    | 'firstParty'
    | 'openai'
    | 'github'
    | 'bedrock'
    | 'vertex'
    | 'gemini'
    | 'codex'
    | 'foundry' = 'firstParty',
) {
  mock.restore()
  mock.module('src/utils/model/providers.js', () => ({
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => true,
  }))
  return import(`./withRetry.js?ts=${Date.now()}-${Math.random()}`)
}

async function importWithRetryForQuotaAttemptTest(options: {
  baseProvider: 'firstParty' | 'openai' | 'github' | 'bedrock' | 'vertex' | 'gemini' | 'codex' | 'foundry'
  enforceQuotaSpy: ReturnType<typeof mock>
}) {
  mock.restore()
  mock.module('src/utils/model/providers.js', () => ({
    getAPIProvider: () => options.baseProvider,
    getAPIProviderForStatsig: () => options.baseProvider,
    isFirstPartyAnthropicBaseUrl: () => true,
  }))
  mock.module('./clientQuotaGuards.js', () => ({
    enforceClientQuotaGuards: options.enforceQuotaSpy,
  }))
  mock.module('../../utils/sleep.js', () => ({
    sleep: async () => undefined,
  }))
  mock.module('../../utils/auth.js', () => ({
    clearApiKeyHelperCache: () => undefined,
    clearAwsCredentialsCache: () => undefined,
    clearGcpCredentialsCache: () => undefined,
    getClaudeAIOAuthTokens: () => undefined,
    handleOAuth401Error: async () => undefined,
    isClaudeAISubscriber: () => false,
    isEnterpriseSubscriber: () => false,
  }))
  mock.module('../analytics/growthbook.js', () => ({
    getFeatureValue_CACHED_MAY_BE_STALE: () => false,
  }))
  mock.module('../analytics/index.js', () => ({
    logEvent: () => undefined,
  }))

  return import(`./withRetry.js?ts=${Date.now()}-${Math.random()}`)
}

// --- parseOpenAIDuration ---
describe('parseOpenAIDuration', () => {
  test('parses seconds: "1s" → 1000', async () => {
    const { parseOpenAIDuration } = await importFreshWithRetryModule()
    expect(parseOpenAIDuration('1s')).toBe(1000)
  })

  test('parses minutes+seconds: "6m0s" → 360000', async () => {
    const { parseOpenAIDuration } = await importFreshWithRetryModule()
    expect(parseOpenAIDuration('6m0s')).toBe(360000)
  })

  test('parses hours+minutes+seconds: "1h30m0s" → 5400000', async () => {
    const { parseOpenAIDuration } = await importFreshWithRetryModule()
    expect(parseOpenAIDuration('1h30m0s')).toBe(5400000)
  })

  test('parses milliseconds: "500ms" → 500', async () => {
    const { parseOpenAIDuration } = await importFreshWithRetryModule()
    expect(parseOpenAIDuration('500ms')).toBe(500)
  })

  test('parses minutes only: "2m" → 120000', async () => {
    const { parseOpenAIDuration } = await importFreshWithRetryModule()
    expect(parseOpenAIDuration('2m')).toBe(120000)
  })

  test('returns null for empty string', async () => {
    const { parseOpenAIDuration } = await importFreshWithRetryModule()
    expect(parseOpenAIDuration('')).toBeNull()
  })

  test('returns null for unrecognized format', async () => {
    const { parseOpenAIDuration } = await importFreshWithRetryModule()
    expect(parseOpenAIDuration('invalid')).toBeNull()
  })
})

// --- getRateLimitResetDelayMs ---
describe('getRateLimitResetDelayMs - Anthropic (firstParty)', () => {
  test('reads anthropic-ratelimit-unified-reset Unix timestamp', async () => {
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('firstParty')
    const futureUnixSec = Math.floor(Date.now() / 1000) + 60
    const error = makeError({
      'anthropic-ratelimit-unified-reset': String(futureUnixSec),
    })
    const delay = getRateLimitResetDelayMs(error)
    expect(delay).not.toBeNull()
    expect(delay!).toBeGreaterThan(50_000)
    expect(delay!).toBeLessThanOrEqual(60_000)
  })

  test('returns null when header absent', async () => {
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('firstParty')
    const error = makeError({})
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })

  test('returns null when reset is in the past', async () => {
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('firstParty')
    const pastUnixSec = Math.floor(Date.now() / 1000) - 10
    const error = makeError({
      'anthropic-ratelimit-unified-reset': String(pastUnixSec),
    })
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })
})

describe('getRateLimitResetDelayMs - OpenAI provider', () => {
  test('reads x-ratelimit-reset-requests duration string', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('openai')
    const error = makeError({ 'x-ratelimit-reset-requests': '30s' })
    const delay = getRateLimitResetDelayMs(error)
    expect(delay).toBe(30_000)
  })

  test('reads x-ratelimit-reset-tokens and picks the larger delay', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('openai')
    const error = makeError({
      'x-ratelimit-reset-requests': '10s',
      'x-ratelimit-reset-tokens': '1m0s',
    })
    // Should use the larger of the two so we don't retry before both reset
    const delay = getRateLimitResetDelayMs(error)
    expect(delay).toBe(60_000)
  })

  test('returns null when no openai rate limit headers present', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('openai')
    const error = makeError({})
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })

  test('works for github provider too', async () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('github')
    const error = makeError({ 'x-ratelimit-reset-requests': '5s' })
    expect(getRateLimitResetDelayMs(error)).toBe(5_000)
  })

  test('accepts explicit provider to support override-aware retry timing', async () => {
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('firstParty')
    const error = makeError({ 'x-ratelimit-reset-requests': '30s' })
    expect(getRateLimitResetDelayMs(error, 'openai')).toBe(30_000)
  })
})

describe('getRateLimitResetDelayMs - providers without reset headers', () => {
  test('returns null for bedrock', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('bedrock')
    const error = makeError({ 'anthropic-ratelimit-unified-reset': String(Math.floor(Date.now() / 1000) + 60) })
    // Bedrock doesn't use this header — should still return null
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })

  test('returns null for vertex', async () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    const { getRateLimitResetDelayMs } =
      await importFreshWithRetryModule('vertex')
    const error = makeError({})
    expect(getRateLimitResetDelayMs(error)).toBeNull()
  })
})

describe('withRetry quota guard integration', () => {
  test('enforces quota guard once per attempt using provider override transport', async () => {
    const enforceQuotaSpy = mock(async () => undefined)
    const { withRetry } = await importWithRetryForQuotaAttemptTest({
      baseProvider: 'firstParty',
      enforceQuotaSpy,
    })

    const operation = async (_client: unknown, attempt: number) => {
      if (attempt === 1) {
        throw new APIError(
          429,
          undefined,
          'rate limit exceeded',
          new Headers({
            'x-should-retry': 'true',
            'retry-after': '0',
          }),
        )
      }
      return 'ok'
    }

    const generator = withRetry(
      async () => ({}) as any,
      operation,
      {
        maxRetries: 1,
        model: 'gpt-4o',
        thinkingConfig: { type: 'disabled' } as any,
        providerOverride: {
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          apiKey: 'test',
        },
      },
    )

    let result: string | undefined
    while (true) {
      const next = await generator.next()
      if (next.done) {
        result = next.value
        break
      }
    }

    expect(result).toBe('ok')
    expect(enforceQuotaSpy).toHaveBeenCalledTimes(2)
    for (const call of enforceQuotaSpy.mock.calls) {
      expect(call[0]?.provider).toBe('openai')
    }
  })
})

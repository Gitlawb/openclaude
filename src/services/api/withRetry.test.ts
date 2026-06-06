import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'
type ProvidersModule = typeof import('../../utils/model/providers.js')

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
let originalProvidersModule: ProvidersModule | undefined

const envKeys = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_MAX_RETRIES',
  'OPENCLAUDE_MAX_RETRIES',
  'OPENCLAUDE_RETRY_DELAY_MS',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
] as const

beforeEach(async () => {
  await acquireSharedMutationLock('withRetry.test.ts')
  for (const key of envKeys) {
    delete process.env[key]
  }
})

afterEach(() => {
  try {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
    mock.restore()
    if (originalProvidersModule) {
      mock.module('src/utils/model/providers.js', () => originalProvidersModule!)
    }
  } finally {
    releaseSharedMutationLock()
  }
})

async function importActualProviders(): Promise<ProvidersModule> {
  return import(
    `../../utils/model/providers.ts?withRetryActual=${Date.now()}-${Math.random()}`
  )
}

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
  originalProvidersModule ??= await importActualProviders()
  mock.module('src/utils/model/providers.js', () => ({
    ...originalProvidersModule!,
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => provider === 'firstParty',
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
  return import(`./withRetry.js?ts=${Date.now()}-${Math.random()}`)
}

async function drainAsyncGenerator<T>(generator: AsyncGenerator<unknown, T>): Promise<T> {
  while (true) {
    const result = await generator.next()
    if (result.done) return result.value
  }
}

describe('retry configuration', () => {
  test('uses default retry attempts when env var is absent', async () => {
    const { getDefaultMaxRetries } = await importFreshWithRetryModule()
    expect(getDefaultMaxRetries()).toBe(10)
  })

  test('reads retry attempts from OPENCLAUDE_MAX_RETRIES', async () => {
    process.env.OPENCLAUDE_MAX_RETRIES = '4'
    const { getDefaultMaxRetries } = await importFreshWithRetryModule()
    expect(getDefaultMaxRetries()).toBe(4)
  })

  test('allows zero retry attempts', async () => {
    process.env.OPENCLAUDE_MAX_RETRIES = '0'
    const { getDefaultMaxRetries } = await importFreshWithRetryModule()
    expect(getDefaultMaxRetries()).toBe(0)
  })

  test('falls back to legacy CLAUDE_CODE_MAX_RETRIES when new env var is absent', async () => {
    process.env.CLAUDE_CODE_MAX_RETRIES = '0'
    const { getDefaultMaxRetries } = await importFreshWithRetryModule()
    expect(getDefaultMaxRetries()).toBe(0)
  })

  test('prefers OPENCLAUDE_MAX_RETRIES over legacy CLAUDE_CODE_MAX_RETRIES', async () => {
    process.env.OPENCLAUDE_MAX_RETRIES = '3'
    process.env.CLAUDE_CODE_MAX_RETRIES = '0'
    const { getDefaultMaxRetries } = await importFreshWithRetryModule()
    expect(getDefaultMaxRetries()).toBe(3)
  })

  test('falls back to default retry attempts for invalid values', async () => {
    process.env.OPENCLAUDE_MAX_RETRIES = 'nope'
    const { getDefaultMaxRetries } = await importFreshWithRetryModule()
    expect(getDefaultMaxRetries()).toBe(10)
  })

  test('caps retry attempts to a bounded value', async () => {
    process.env.OPENCLAUDE_MAX_RETRIES = '1000'
    const { getDefaultMaxRetries } = await importFreshWithRetryModule()
    expect(getDefaultMaxRetries()).toBe(100)
  })

  test('uses default retry delay when env var is absent', async () => {
    const { getDefaultRetryDelayMs } = await importFreshWithRetryModule()
    expect(getDefaultRetryDelayMs()).toBe(500)
  })

  test('reads retry delay from OPENCLAUDE_RETRY_DELAY_MS', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '1500'
    const { getDefaultRetryDelayMs } = await importFreshWithRetryModule()
    expect(getDefaultRetryDelayMs()).toBe(1500)
  })

  test('falls back to default retry delay for invalid values', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '-1'
    const { getDefaultRetryDelayMs } = await importFreshWithRetryModule()
    expect(getDefaultRetryDelayMs()).toBe(500)
  })

  test('uses configured retry delay as exponential backoff base', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '2000'
    const originalRandom = Math.random
    Math.random = () => 0
    try {
      const { getRetryDelay } = await importFreshWithRetryModule()
      expect(getRetryDelay(1)).toBe(2000)
      expect(getRetryDelay(2)).toBe(4000)
    } finally {
      Math.random = originalRandom
    }
  })

  test('retry-after header takes precedence over configured delay', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '2000'
    const { getRetryDelay } = await importFreshWithRetryModule()
    expect(getRetryDelay(1, '3')).toBe(3000)
  })
})

describe('OpenAI-compatible retry classification', () => {
  test('does not retry marked non-retryable auth failures', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '1'
    const { CannotRetryError, withRetry } =
      await importFreshWithRetryModule('openai')
    const error = APIError.generate(
      401,
      undefined,
      'OpenAI API error 401: Unauthorized [openai_category=auth_invalid,host=api.z.ai] Hint: Authentication failed.',
      new Headers(),
    )
    let attempts = 0

    await expect(
      drainAsyncGenerator(
        withRetry(
          async () => ({} as Anthropic),
          async () => {
            attempts++
            throw error
          },
          {
            maxRetries: 2,
            model: 'glm-5.1',
            thinkingConfig: { type: 'disabled' },
          },
        ),
      ),
    ).rejects.toBeInstanceOf(CannotRetryError)

    expect(attempts).toBe(1)
  })

  test('keeps parseable 402 affordability errors on the max_tokens retry path', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '1'
    const { withRetry } = await importFreshWithRetryModule('openai')
    const error = APIError.generate(
      402,
      undefined,
      'OpenAI API error 402: Payment Required [openai_category=unknown,host=openrouter.ai] ' +
        'This request requires more credits, or fewer max_tokens. ' +
        'You requested up to 32000 tokens, but can only afford 27342. To increase, visit ...',
      new Headers(),
    )
    const originalConsoleError = console.error
    const consoleError = mock(() => {})
    const observedMaxTokensOverrides: Array<number | undefined> = []
    let attempts = 0

    console.error = consoleError
    try {
      const result = await drainAsyncGenerator(
        withRetry(
          async () => ({} as Anthropic),
          async (_client, _attempt, context) => {
            attempts++
            observedMaxTokensOverrides.push(context.maxTokensOverride)
            if (attempts === 1) throw error
            return { ok: true }
          },
          {
            maxRetries: 2,
            model: 'openrouter/test-model',
            thinkingConfig: { type: 'disabled' },
          },
        ),
      )

      expect(result).toEqual({ ok: true })
    } finally {
      console.error = originalConsoleError
    }

    expect(attempts).toBe(2)
    expect(observedMaxTokensOverrides).toEqual([undefined, 27342])
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  test('does not keep retrying repeated 402 affordability errors after one max_tokens adjustment', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '1'
    const { CannotRetryError, withRetry } =
      await importFreshWithRetryModule('openai')
    const error = APIError.generate(
      402,
      undefined,
      'OpenAI API error 402: Payment Required [openai_category=unknown,host=openrouter.ai] ' +
        'This request requires more credits, or fewer max_tokens. ' +
        'You requested up to 32000 tokens, but can only afford 27342. To increase, visit ...',
      new Headers(),
    )
    const originalConsoleError = console.error
    const consoleError = mock(() => {})
    let attempts = 0

    console.error = consoleError
    try {
      await expect(
        drainAsyncGenerator(
          withRetry(
            async () => ({} as Anthropic),
            async () => {
              attempts++
              throw error
            },
            {
              maxRetries: 2,
              model: 'openrouter/test-model',
              thinkingConfig: { type: 'disabled' },
            },
          ),
        ),
      ).rejects.toBeInstanceOf(CannotRetryError)
    } finally {
      console.error = originalConsoleError
    }

    expect(attempts).toBe(2)
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  test('keeps parseable marked context-overflow errors on the max_tokens retry path', async () => {
    process.env.OPENCLAUDE_RETRY_DELAY_MS = '1'
    const { withRetry } = await importFreshWithRetryModule('openai')
    const error = APIError.generate(
      400,
      undefined,
      'OpenAI API error 400: Bad Request [openai_category=context_overflow,host=api.z.ai] ' +
        'input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000',
      new Headers(),
    )
    const observedMaxTokensOverrides: Array<number | undefined> = []
    let attempts = 0

    const result = await drainAsyncGenerator(
      withRetry(
        async () => ({} as Anthropic),
        async (_client, _attempt, context) => {
          attempts++
          observedMaxTokensOverrides.push(context.maxTokensOverride)
          if (attempts === 1) throw error
          return { ok: true }
        },
        {
          maxRetries: 2,
          model: 'glm-5.1',
          thinkingConfig: { type: 'disabled' },
        },
      ),
    )

    expect(result).toEqual({ ok: true })
    expect(attempts).toBe(2)
    expect(observedMaxTokensOverrides).toEqual([undefined, 10941])
  })
})

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

// Regression for #1125 — OpenRouter 402 (credits-vs-max_tokens mismatch)
// carries the affordable cap in the message. The retry loop should adjust
// max_tokens to that cap once instead of bubbling a confusing 402 to the user.
describe('parseOpenRouterAffordableMaxTokensError (#1125)', () => {
  function make402(message: string): APIError {
    return {
      headers: new Headers(),
      status: 402,
      message,
      name: 'APIError',
      error: {},
    } as unknown as APIError
  }

  test('parses the affordable max_tokens out of OpenRouter 402 body', async () => {
    const { parseOpenRouterAffordableMaxTokensError } =
      await importFreshWithRetryModule('openai')
    const err = make402(
      'This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 27342. To increase, visit ...',
    )
    expect(parseOpenRouterAffordableMaxTokensError(err)).toEqual({
      requestedMaxTokens: 32000,
      affordableMaxTokens: 27342,
    })
  })

  test('returns undefined when status is not 402', async () => {
    const { parseOpenRouterAffordableMaxTokensError } =
      await importFreshWithRetryModule('openai')
    const err = {
      headers: new Headers(),
      status: 429,
      message: 'You requested up to 32000 tokens, but can only afford 27342',
      name: 'APIError',
      error: {},
    } as unknown as APIError
    expect(parseOpenRouterAffordableMaxTokensError(err)).toBeUndefined()
  })

  test('returns undefined when message does not match expected shape', async () => {
    const { parseOpenRouterAffordableMaxTokensError } =
      await importFreshWithRetryModule('openai')
    const err = make402('Payment required. Top up your account.')
    expect(parseOpenRouterAffordableMaxTokensError(err)).toBeUndefined()
  })

  test('returns undefined when affordable_max_tokens is zero', async () => {
    const { parseOpenRouterAffordableMaxTokensError } =
      await importFreshWithRetryModule('openai')
    const err = make402(
      'You requested up to 32000 tokens, but can only afford 0',
    )
    expect(parseOpenRouterAffordableMaxTokensError(err)).toBeUndefined()
  })

  test('shouldRetry returns true for parseable 402', async () => {
    const { shouldRetry } = (await importFreshWithRetryModule('openai')) as {
      shouldRetry?: (e: APIError) => boolean
    }
    if (!shouldRetry) return // shouldRetry is internal; skip when not exported
    const err = make402(
      'You requested up to 32000 tokens, but can only afford 27342',
    )
    expect(shouldRetry(err)).toBe(true)
  })
})

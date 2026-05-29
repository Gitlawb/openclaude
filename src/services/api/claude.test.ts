import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk/error'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'

// Local stub classes that mirror the real error shapes. Used in the withRetry
// mock so claude.ts's instanceof checks don't throw when the module loads.
class StubCannotRetryError extends Error {
  originalError: unknown
  retryContext: unknown
  constructor(originalError: unknown, retryContext: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError))
    this.name = 'RetryError'
    this.originalError = originalError
    this.retryContext = retryContext
  }
}

class StubFallbackTriggeredError extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// Shared test infrastructure
// ─────────────────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env }

beforeEach(async () => {
  await acquireSharedMutationLock('claude.test.ts')
})

afterEach(() => {
  try {
    for (const key of Object.keys(process.env)) {
      if ((originalEnv as Record<string, string | undefined>)[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = (originalEnv as Record<string, string>)[key]
      }
    }
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

/**
 * Set up the minimum required module mocks for claude.ts to load and the two
 * targeted functions to work. Only mocks modules we MUST control; everything
 * else loads from its real implementation so incomplete-mock errors don't
 * cascade.
 *
 * @param opts.provider      - Value returned by getAPIProvider()
 * @param opts.isFirstParty  - Value returned by isFirstPartyAnthropicBaseUrl()
 * @param opts.getClientSpy  - Optional replacement for getAnthropicClient
 * @param opts.withRetrySpy  - Optional replacement for the withRetry generator
 */
function applyClaudeMocks(opts: {
  provider?: string
  isFirstParty?: boolean
  getClientSpy?: (options: unknown) => unknown
  withRetrySpy?: (
    getClient: () => Promise<unknown>,
    operation: (client: unknown, attempt: number, context: unknown) => Promise<unknown>,
    options: unknown,
  ) => AsyncGenerator<unknown, unknown>
}) {
  const provider = opts.provider ?? 'firstParty'
  const isFirstParty = opts.isFirstParty ?? true

  // Required: controls which provider path the code takes.
  mock.module('src/utils/model/providers.js', () => ({
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => isFirstParty,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))

  // Required: lets tests spy on getAnthropicClient.
  mock.module('./client.js', () => ({
    CLIENT_REQUEST_ID_HEADER: 'x-client-request-id',
    getAnthropicClient: opts.getClientSpy ?? (async () => ({})),
  }))

  // Required: withRetry is the retry machinery; mock it so tests don't need
  // real authentication or network access. Must export all named symbols that
  // claude.ts imports to avoid "Export not found" link errors.
  const defaultWithRetry = async function* () {}
  mock.module('./withRetry.js', () => ({
    withRetry: opts.withRetrySpy ?? defaultWithRetry,
    CannotRetryError: StubCannotRetryError,
    FallbackTriggeredError: StubFallbackTriggeredError,
    is529Error: () => false,
    DEFAULT_RETRY_DELAY_MS: 500,
    BASE_DELAY_MS: 500,
    getDefaultMaxRetries: () => 10,
    getDefaultRetryDelayMs: () => 500,
    getRetryDelay: () => 500,
    parseOpenRouterAffordableMaxTokensError: () => undefined,
    parseMaxTokensContextOverflowError: () => undefined,
    parseOpenAIDuration: () => null,
    getRateLimitResetDelayMs: () => null,
  }))
}

/** Fresh dynamic import of claude.ts with a cache-busting URL. */
async function importClaudeFresh() {
  return import(`./claude.js?ts=${Date.now()}-${Math.random()}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldAttachClientRequestIdHeader
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldAttachClientRequestIdHeader', () => {
  test('returns false when providerOverride is present', async () => {
    mock.restore()
    applyClaudeMocks({ provider: 'firstParty', isFirstParty: true })

    const { shouldAttachClientRequestIdHeader } = await importClaudeFresh()

    const providerOverride = {
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'test-key',
    }
    // Even though getAPIProvider() returns 'firstParty', a present
    // providerOverride must short-circuit the check to false.
    expect(shouldAttachClientRequestIdHeader(providerOverride)).toBe(false)
  })

  test('returns true when no providerOverride and provider is firstParty', async () => {
    mock.restore()
    applyClaudeMocks({ provider: 'firstParty', isFirstParty: true })

    const { shouldAttachClientRequestIdHeader } = await importClaudeFresh()

    expect(shouldAttachClientRequestIdHeader(undefined)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// executeNonStreamingRequest — providerOverride propagation
//
// Regression for the 404 fallback path (claude.ts ~line 2678): when the
// streaming endpoint returns 404 (a CannotRetryError wrapping APIError 404),
// queryModel falls through to executeNonStreamingRequest and MUST forward
// options.providerOverride. This test verifies that executeNonStreamingRequest
// itself propagates providerOverride all the way to getAnthropicClient, closing
// the only place the value could be dropped.
// ─────────────────────────────────────────────────────────────────────────────

describe('executeNonStreamingRequest providerOverride propagation', () => {
  test('forwards providerOverride to getAnthropicClient', async () => {
    mock.restore()

    const capturedClientOptions: Array<Record<string, unknown>> = []

    const mockAnthropicClient = {
      beta: {
        messages: {
          create: async (_params: unknown) => ({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'test-model',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          }),
        },
      },
    }

    applyClaudeMocks({
      provider: 'openai',
      isFirstParty: false,
      // Spy that records every call's options and returns a working client.
      getClientSpy: (opts: unknown) => {
        capturedClientOptions.push(opts as Record<string, unknown>)
        return Promise.resolve(mockAnthropicClient)
      },
      // Minimal withRetry: calls getClient() once, runs the operation, and
      // returns the result — no retry loop needed to verify propagation.
      withRetrySpy: async function* (
        getClient: () => Promise<unknown>,
        operation: (client: unknown, attempt: number, ctx: unknown) => Promise<unknown>,
        options: Record<string, unknown>,
      ) {
        const client = await getClient()
        const result = await operation(client, 1, {
          model: (options.model as string) ?? 'test-model',
          thinkingConfig: options.thinkingConfig ?? { type: 'disabled' },
        })
        return result
      },
    })

    const { executeNonStreamingRequest } = await importClaudeFresh()

    const providerOverride = {
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'test-provider-key',
    }

    const controller = new AbortController()
    const gen = executeNonStreamingRequest(
      {
        model: 'test-model',
        source: 'test_source',
        providerOverride,
      },
      {
        model: 'test-model',
        thinkingConfig: { type: 'disabled' },
        signal: controller.signal,
      },
      // paramsFromContext: returns minimal valid BetaMessageStreamParams
      (_context: unknown) => ({
        model: 'test-model',
        max_tokens: 100,
        messages: [{ role: 'user' as const, content: 'hello' }],
      }),
      () => {}, // onAttempt
      () => {}, // captureRequest
    )

    // Drain the generator (no system-message yields expected here).
    let done = false
    while (!done) {
      const next = await gen.next()
      done = next.done ?? false
    }

    // getAnthropicClient must have been called exactly once, with providerOverride.
    expect(capturedClientOptions).toHaveLength(1)
    expect(capturedClientOptions[0]?.providerOverride).toEqual(providerOverride)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// queryModel 404 stream-creation fallback — end-to-end providerOverride check
//
// Drives the full 404 fallback path through queryModel itself (not just
// executeNonStreamingRequest in isolation) to guard against line 2678
// regressing by dropping providerOverride from the executeNonStreamingRequest
// call. If that regression occurs, capturedClientOptions[0].providerOverride
// will be undefined and this test fails.
// ─────────────────────────────────────────────────────────────────────────────

describe('queryModel 404 stream-creation fallback — providerOverride propagation', () => {
  test('providerOverride reaches getAnthropicClient on non-streaming fallback', async () => {
    mock.restore()

    // MACRO is a build-time global normally injected by the Bun bundler.
    // Tests run without bundling so we inject it onto globalThis so that
    // modules like fingerprint.ts and system.ts resolve MACRO.VERSION etc.
    const globalWithMacro = globalThis as Record<string, unknown>
    const originalMacro = globalWithMacro.MACRO
    globalWithMacro.MACRO = {
      VERSION: '0.0.0-test',
      DISPLAY_VERSION: '0.0.0-test',
      BUILD_TIME: new Date(0).toISOString(),
      ISSUES_EXPLAINER: '',
      PACKAGE_URL: '',
      NATIVE_PACKAGE_URL: undefined,
    }

    const capturedClientOptions: Array<Record<string, unknown>> = []
    let withRetryCallCount = 0

    const mockBetaMessage = {
      id: 'msg_fallback_test',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }

    const mockAnthropicClient = {
      beta: {
        messages: {
          create: async (_params: unknown) => mockBetaMessage,
        },
      },
    }

    applyClaudeMocks({
      provider: 'openai',
      isFirstParty: false,
      getClientSpy: (opts: unknown) => {
        capturedClientOptions.push(opts as Record<string, unknown>)
        return Promise.resolve(mockAnthropicClient)
      },
      withRetrySpy: async function* (
        getClient: () => Promise<unknown>,
        operation: (client: unknown, attempt: number, ctx: unknown) => Promise<unknown>,
        options: Record<string, unknown>,
      ) {
        withRetryCallCount++
        if (withRetryCallCount === 1) {
          // First invocation: the streaming withRetry in queryModel.
          // Throw CannotRetryError wrapping a real APIError with status 404 to
          // trigger the stream-creation 404 fallback at claude.ts line 2625+.
          const apiError = new APIError(404, null, 'Not Found', undefined)
          throw new StubCannotRetryError(apiError, { model: 'claude-3-5-haiku-20241022' })
        }
        // Second invocation: the non-streaming withRetry inside executeNonStreamingRequest.
        // Call getClient (which hits our getAnthropicClient spy) then run the operation.
        const client = await getClient()
        const result = await operation(client, 1, {
          model: (options.model as string) ?? 'claude-3-5-haiku-20241022',
          thinkingConfig: options.thinkingConfig ?? { type: 'disabled' },
        })
        return result
      },
    })

    const { queryModelWithoutStreaming } = await importClaudeFresh()

    const providerOverride = {
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'test-provider-key-fallback',
    }

    const controller = new AbortController()
    const options = {
      model: 'claude-3-5-haiku-20241022',
      getToolPermissionContext: () =>
        Promise.resolve({
          mode: 'default',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        }),
      isNonInteractiveSession: true,
      hasAppendSystemPrompt: false,
      agents: [],
      mcpTools: [],
      querySource: 'api',
      providerOverride,
    }

    await queryModelWithoutStreaming({
      messages: [],
      systemPrompt: [],
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: controller.signal,
      options,
    })

    // Restore original MACRO value after the test.
    globalWithMacro.MACRO = originalMacro

    // The non-streaming fallback (2nd withRetry) must call getAnthropicClient
    // with providerOverride. If line 2678 drops providerOverride, this fails.
    expect(capturedClientOptions).toHaveLength(1)
    expect(capturedClientOptions[0]?.providerOverride).toEqual(providerOverride)
  })
})

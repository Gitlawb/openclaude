import { APIError } from '@anthropic-ai/sdk'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'
import { asMockFetch } from '../../test/typedMocks.js'
import { _clearRegistryForTesting, ensureIntegrationsLoaded, registerGateway } from '../../integrations/index.ts'
import { applyProviderFlag } from '../../utils/providerFlag.ts'
import { applyProviderProfileToProcessEnv } from '../../utils/providerProfiles.ts'
import {
  getAssistantMessageFromError,
  OPENCODE_GO_FREE_LIMIT_ERROR_MESSAGE,
} from './errors.ts'
import { createOpenAIShimClient, hasMistralApiHost } from './openaiShim.ts'
import * as realCodexShim from './codexShim.js'
import * as realGithubModelsCredentials from '../../utils/githubModelsCredentials.js'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_API_KEYS: process.env.OPENAI_API_KEYS,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_API_FORMAT: process.env.OPENAI_API_FORMAT,
  OPENAI_AZURE_STYLE: process.env.OPENAI_AZURE_STYLE,
  OPENAI_AUTH_HEADER: process.env.OPENAI_AUTH_HEADER,
  OPENAI_AUTH_SCHEME: process.env.OPENAI_AUTH_SCHEME,
  OPENAI_AUTH_HEADER_VALUE: process.env.OPENAI_AUTH_HEADER_VALUE,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  GITHUB_COPILOT_KEY: process.env.GITHUB_COPILOT_KEY,
  GITHUB_ENTERPRISE_URL: process.env.GITHUB_ENTERPRISE_URL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GEMINI_ACCESS_TOKEN: process.env.GEMINI_ACCESS_TOKEN,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  BNKR_API_KEY: process.env.BNKR_API_KEY,
  BANKR_BASE_URL: process.env.BANKR_BASE_URL,
  BANKR_MODEL: process.env.BANKR_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  MIMO_API_KEY: process.env.MIMO_API_KEY,
  OPENGATEWAY_API_KEY: process.env.OPENGATEWAY_API_KEY,
  OPENGATEWAY_BASE_URL: process.env.OPENGATEWAY_BASE_URL,
  OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID: process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
  CLAUDE_STREAM_IDLE_TIMEOUT_MS: process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS,
}

const originalFetch = globalThis.fetch

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

type OpenAIShimClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<unknown> & {
        withResponse: () => Promise<{ data: AsyncIterable<Record<string, unknown>> }>
      }
    }
  }
}

function makeSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line))
        }
        controller.close()
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
      },
    },
  )
}

function withResponseUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', {
    value: url,
    configurable: true,
  })
  return response
}

type StallingResponse = {
  response: Response
  cancelReasons: unknown[]
  close: () => void
}

function makeStallingResponse(
  firstChunk: string,
  url = 'https://api.example.test/v1/chat/completions',
  contentType = 'text/event-stream',
): StallingResponse {
  const encoder = new TextEncoder()
  const cancelReasons: unknown[] = []
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let closed = false

  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(encoder.encode(firstChunk))
      },
      cancel(reason) {
        closed = true
        cancelReasons.push(reason)
      },
    }),
    {
      headers: {
        'Content-Type': contentType,
      },
    },
  )

  return {
    response: withResponseUrl(response, url),
    cancelReasons,
    close: () => {
      if (closed) return
      closed = true
      try {
        streamController?.close()
      } catch {
        // The test may already have cancelled the stream.
      }
    },
  }
}

type ShimStream = AsyncIterable<Record<string, unknown>> & {
  controller: AbortController
}

type StreamDrainOutcome =
  | { status: 'completed'; events: Array<Record<string, unknown>> }
  | {
    status: 'rejected'
    events: Array<Record<string, unknown>>
    error: unknown
  }

async function waitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

async function expectAbortStopsStream({
  abort,
  cancelReasons,
  expectedEventsBeforeAbort,
  label,
  stream,
}: {
  abort: () => void
  cancelReasons: unknown[]
  expectedEventsBeforeAbort: number
  label: string
  stream: ShimStream
}): Promise<StreamDrainOutcome> {
  const events: Array<Record<string, unknown>> = []
  let resolveReady!: () => void
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve
  })

  const drain = (async (): Promise<StreamDrainOutcome> => {
    try {
      for await (const event of stream) {
        events.push(event)
        if (events.length >= expectedEventsBeforeAbort) {
          resolveReady()
        }
      }
      return { status: 'completed', events }
    } catch (error) {
      return { status: 'rejected', events, error }
    }
  })()

  await waitForPromise(
    ready,
    500,
    `${label} did not produce initial stream events`,
  )
  // Let the for-await loop ask the stream reader for the next chunk, so the
  // abort has to wake a real pending read rather than only flipping a flag.
  await Promise.resolve()
  await Promise.resolve()

  abort()

  const outcome = await waitForPromise(
    drain,
    500,
    `${label} did not stop promptly after abort`,
  )
  expect(cancelReasons).toHaveLength(1)
  expect(outcome.status).toBe('rejected')
  if (outcome.status === 'rejected') {
    expect((outcome.error as { name?: unknown }).name).toBe('AbortError')
  }
  return outcome
}

async function expectPausedAbortCancelsStream({
  cancelReasons,
  label,
  stream,
}: {
  cancelReasons: unknown[]
  label: string
  stream: ShimStream
}): Promise<IteratorResult<Record<string, unknown>>> {
  const iterator = stream[Symbol.asyncIterator]()
  const first = await waitForPromise(
    iterator.next(),
    500,
    `${label} did not produce first stream event`,
  )
  expect(first.done).toBe(false)

  stream.controller.abort()
  await waitForPromise(
    (async () => {
      for (let i = 0; i < 10; i++) {
        if (cancelReasons.length > 0) return
        await Promise.resolve()
      }
      throw new Error(`${label} did not cancel source on controller abort`)
    })(),
    500,
    `${label} did not cancel source on controller abort`,
  )

  const returned = await waitForPromise(
    Promise.resolve(iterator.return?.()),
    500,
    `${label} did not return promptly after abort while paused`,
  )
  expect(cancelReasons).toHaveLength(1)
  return returned as IteratorResult<Record<string, unknown>>
}

async function expectBufferedAbortRejectsNext({
  expectedText,
  label,
  stream,
}: {
  expectedText?: string
  label: string
  stream: ShimStream
}): Promise<void> {
  const iterator = stream[Symbol.asyncIterator]()

  try {
    let firstDelta: Record<string, unknown> | undefined
    for (let i = 0; i < 5; i++) {
      const next = await waitForPromise(
        iterator.next(),
        500,
        `${label} did not produce expected pre-abort events`,
      )
      expect(next.done).toBe(false)
      if (next.value?.type === 'content_block_delta') {
        firstDelta = next.value
        break
      }
    }

    expect(firstDelta).toBeDefined()
    if (expectedText !== undefined) {
      expect((firstDelta as { delta?: { text?: string } }).delta?.text).toBe(expectedText)
    }

    stream.controller.abort()
    const afterAbort = await waitForPromise(
      iterator.next().then(
        value => ({ status: 'resolved' as const, value }),
        error => ({ status: 'rejected' as const, error }),
      ),
      500,
      `${label} did not stop after abort`,
    )

    if (afterAbort.status !== 'rejected') {
      throw new Error(`${label} yielded after abort: ${JSON.stringify(afterAbort.value)}`)
    }
    expect((afterAbort.error as { name?: unknown }).name).toBe('AbortError')
  } finally {
    await Promise.resolve(iterator.return?.()).catch(() => {})
  }
}

function makeOpenAIStreamFrame(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-abort-test',
    object: 'chat.completion.chunk',
    created: 1_780_000_000,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

function makeStreamChunks(chunks: unknown[]): string[] {
  return [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ]
}

function importFreshOpenAIShim(
  cacheKey: string,
): Promise<typeof import('./openaiShim.ts')> {
  return import(`./openaiShim.ts?${cacheKey}`)
}

type StreamIdleTestApi = {
  StreamIdleTimeoutError: new (timeoutMs: number) => Error
  getStreamIdleTimeoutMs: () => number
  readWithIdleTimeout: (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
    options?: { signal?: AbortSignal; onTimeout?: () => void },
  ) => Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>>
}

async function getStreamIdleTestApi(cacheKey: string): Promise<StreamIdleTestApi> {
  const mod = await importFreshOpenAIShim(cacheKey)
  const testApi = mod.__test as unknown as Partial<StreamIdleTestApi>
  expect(typeof testApi.StreamIdleTimeoutError).toBe('function')
  expect(typeof testApi.getStreamIdleTimeoutMs).toBe('function')
  expect(typeof testApi.readWithIdleTimeout).toBe('function')
  return testApi as StreamIdleTestApi
}

function makeChatCompletionResponse(model: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'ok',
          },
          finish_reason: 'stop',
        },
      ],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

async function captureChatCompletionRequest(
  model = 'mimo-v2.5-pro',
): Promise<{ authorization: string | null; url: string | null }> {
  let authorization: string | null = null
  let url: string | null = null

  globalThis.fetch = (async (input, init) => {
    url = String(input)
    const headers = init?.headers as Record<string, string> | undefined
    authorization = headers?.Authorization ?? headers?.authorization ?? null

    return makeChatCompletionResponse(model)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model,
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  return { authorization, url }
}

beforeEach(async () => {
  await acquireSharedMutationLock('openaiShim.test.ts')
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  delete process.env.OPENAI_API_BASE
  process.env.OPENAI_API_KEY = 'test-key'
  delete process.env.OPENAI_API_KEYS
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_API_FORMAT
  delete process.env.OPENAI_AZURE_STYLE
  delete process.env.OPENAI_AUTH_HEADER
  delete process.env.OPENAI_AUTH_SCHEME
  delete process.env.OPENAI_AUTH_HEADER_VALUE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_COPILOT_KEY
  delete process.env.GITHUB_ENTERPRISE_URL
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_MODEL
  delete process.env.GOOGLE_CLOUD_PROJECT
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
  delete process.env.NVIDIA_API_KEY
  delete process.env.NVIDIA_NIM
  delete process.env.MINIMAX_API_KEY
  delete process.env.BNKR_API_KEY
  delete process.env.BANKR_BASE_URL
  delete process.env.BANKR_MODEL
  delete process.env.OPENROUTER_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.MIMO_API_KEY
  delete process.env.OPENGATEWAY_API_KEY
  delete process.env.OPENGATEWAY_BASE_URL
  delete process.env.OPENCODE_API_KEY
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
  delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS
})

afterEach(() => {
  try {
    restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
    restoreEnv('OPENAI_API_BASE', originalEnv.OPENAI_API_BASE)
    restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
    restoreEnv('OPENAI_API_KEYS', originalEnv.OPENAI_API_KEYS)
    restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
    restoreEnv('OPENAI_API_FORMAT', originalEnv.OPENAI_API_FORMAT)
    restoreEnv('OPENAI_AZURE_STYLE', originalEnv.OPENAI_AZURE_STYLE)
    restoreEnv('OPENAI_AUTH_HEADER', originalEnv.OPENAI_AUTH_HEADER)
    restoreEnv('OPENAI_AUTH_SCHEME', originalEnv.OPENAI_AUTH_SCHEME)
    restoreEnv('OPENAI_AUTH_HEADER_VALUE', originalEnv.OPENAI_AUTH_HEADER_VALUE)
    restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
    restoreEnv('GITHUB_COPILOT_KEY', originalEnv.GITHUB_COPILOT_KEY)
    restoreEnv('GITHUB_ENTERPRISE_URL', originalEnv.GITHUB_ENTERPRISE_URL)
    restoreEnv('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN)
    restoreEnv('GH_TOKEN', originalEnv.GH_TOKEN)
    restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
    restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
    restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
    restoreEnv('GOOGLE_API_KEY', originalEnv.GOOGLE_API_KEY)
    restoreEnv('GEMINI_ACCESS_TOKEN', originalEnv.GEMINI_ACCESS_TOKEN)
    restoreEnv('GEMINI_AUTH_MODE', originalEnv.GEMINI_AUTH_MODE)
    restoreEnv('GEMINI_BASE_URL', originalEnv.GEMINI_BASE_URL)
    restoreEnv('GEMINI_MODEL', originalEnv.GEMINI_MODEL)
    restoreEnv('GOOGLE_CLOUD_PROJECT', originalEnv.GOOGLE_CLOUD_PROJECT)
    restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
    restoreEnv('NVIDIA_API_KEY', originalEnv.NVIDIA_API_KEY)
    restoreEnv('NVIDIA_NIM', originalEnv.NVIDIA_NIM)
    restoreEnv('MINIMAX_API_KEY', originalEnv.MINIMAX_API_KEY)
    restoreEnv('BNKR_API_KEY', originalEnv.BNKR_API_KEY)
    restoreEnv('BANKR_BASE_URL', originalEnv.BANKR_BASE_URL)
    restoreEnv('BANKR_MODEL', originalEnv.BANKR_MODEL)
    restoreEnv('OPENROUTER_API_KEY', originalEnv.OPENROUTER_API_KEY)
    restoreEnv('DEEPSEEK_API_KEY', originalEnv.DEEPSEEK_API_KEY)
    restoreEnv('MIMO_API_KEY', originalEnv.MIMO_API_KEY)
    restoreEnv('OPENGATEWAY_API_KEY', originalEnv.OPENGATEWAY_API_KEY)
    restoreEnv('OPENGATEWAY_BASE_URL', originalEnv.OPENGATEWAY_BASE_URL)
    restoreEnv('OPENCODE_API_KEY', originalEnv.OPENCODE_API_KEY)
    restoreEnv('CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED', originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED)
    restoreEnv('CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID', originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID)
    restoreEnv('CLAUDE_STREAM_IDLE_TIMEOUT_MS', originalEnv.CLAUDE_STREAM_IDLE_TIMEOUT_MS)
    globalThis.fetch = originalFetch
    _clearRegistryForTesting()
    ensureIntegrationsLoaded()
  } finally {
    releaseSharedMutationLock()
  }
})

// openaiShim test extraction seam 001 start: strips canonical Anthropic headers from direct shim defaultHeaders
test('strips canonical Anthropic headers from direct shim defaultHeaders', async () => {
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 3,
          total_tokens: 11,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    defaultHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-anthropic-additional-protection': 'true',
      'x-claude-remote-session-id': 'remote-123',
      'x-app': 'cli',
      'x-client-app': 'sdk',
      'x-safe-header': 'keep-me',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('anthropic-beta')).toBeNull()
  expect(capturedHeaders?.get('x-anthropic-additional-protection')).toBeNull()
  expect(capturedHeaders?.get('x-claude-remote-session-id')).toBeNull()
  expect(capturedHeaders?.get('x-app')).toBeNull()
  expect(capturedHeaders?.get('x-client-app')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
})
// openaiShim test extraction seam 001 end


// openaiShim test extraction seam 002 start: uses OpenAI-compatible responses endpoint when OPENAI_API_FORMAT=responses

// openaiShim test extraction seam 002 end


// openaiShim test extraction seam 003 start: nests reasoning effort for OpenAI-compatible responses endpoint

// openaiShim test extraction seam 003 end


// openaiShim test extraction seam 004 start: uses OpenAI-compatible responses endpoint with text chunk types when OPENAI_API_FORMAT=responses_compat

// openaiShim test extraction seam 004 end


// openaiShim test extraction seam 005 start: uses correct empty input fallback schema for standard responses and responses_compat
test('uses correct empty input fallback schema for standard responses and responses_compat', async () => {
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      id: 'resp-1',
      model: 'test',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }]
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  process.env.OPENAI_API_FORMAT = 'responses'
  await client.beta.messages.create({
    model: 'test',
    max_tokens: 10,
    messages: [{ role: 'user', content: [] }],
  })

  expect(capturedBody?.input).toEqual([
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '' }],
    },
  ])

  process.env.OPENAI_API_FORMAT = 'responses_compat'
  await client.beta.messages.create({
    model: 'test',
    max_tokens: 10,
    messages: [{ role: 'user', content: [] }],
  })

  expect(capturedBody?.input).toEqual([
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'text', text: '' }],
    },
  ])
})
// openaiShim test extraction seam 005 end


// openaiShim test extraction seam 006 start: strips store from strict OpenAI-compatible responses providers

// openaiShim test extraction seam 006 end


// openaiShim test extraction seam 007 start: strips store when providerOverride routes chat_completions to the Gemini host

// openaiShim test extraction seam 007 end


// openaiShim test extraction seam 008 start: strips store when providerOverride routes responses API to the Gemini host

// openaiShim test extraction seam 008 end


// openaiShim test extraction seam 009 start: uses custom OpenAI-compatible auth header value when configured

// openaiShim test extraction seam 009 end


// openaiShim test extraction seam 010 start: uses Hicap api-key auth header for the Hicap route

// openaiShim test extraction seam 010 end


// openaiShim test extraction seam 011 start: defaults Authorization custom auth header to bearer scheme

// openaiShim test extraction seam 011 end


// openaiShim test extraction seam 012 start: honors bearer scheme for custom OpenAI-compatible auth headers

// openaiShim test extraction seam 012 end


// openaiShim test extraction seam 013 start: ignores custom auth header value when no custom header is configured

// openaiShim test extraction seam 013 end

test('auto-routes gpt-5.6 to /responses on api.openai.com with tools and nested reasoning', async () => {
  // No OPENAI_API_FORMAT set: the model+base predicate must pick responses.
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.6-sol',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'high' }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        name: 'get_weather',
        description: 'Get the weather',
        input_schema: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.openai.com/v1/responses')
  expect(Array.isArray(capturedBody?.tools)).toBe(true)
  expect((capturedBody?.tools as unknown[]).length).toBe(1)
  expect(JSON.stringify(capturedBody?.tools)).toContain('get_weather')
  expect(capturedBody?.reasoning).toEqual({ effort: 'high', summary: 'auto' })
  expect(capturedBody).not.toHaveProperty('reasoning_effort')
})

test('gpt-5.6 chat-completions escape hatch omits reasoning effort with tools', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_API_FORMAT = 'chat_completions'
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.6-sol',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'high' }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{
      name: 'get_weather',
      description: 'Get the weather',
      input_schema: { type: 'object', properties: {} },
    }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
  expect(capturedBody?.tools).toBeDefined()
  expect(capturedBody).not.toHaveProperty('reasoning_effort')
})

test('gpt-5.4 chat-completions escape hatch omits reasoning effort with tools', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_API_FORMAT = 'chat_completions'
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      id: 'chatcmpl-1', model: 'gpt-5.4',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'high' }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ name: 'get_weather', description: 'Get the weather', input_schema: { type: 'object', properties: {} } }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedBody).not.toHaveProperty('reasoning_effort')
})

test('gpt-5.6 chat-completions escape hatch keeps reasoning effort without tools', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_API_FORMAT = 'chat_completions'
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.6-sol',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'high' }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedBody?.reasoning_effort).toBe('high')
})

test('auto-route leaves non gpt-5.4+ models on chat/completions', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
})

test('auto-route does NOT fire for arbitrary non-OpenAI gateway bases', async () => {
  process.env.OPENAI_BASE_URL = 'https://gateway.example/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.6-sol',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://gateway.example/v1/chat/completions')
})

test('auto-routed responses on a bare Azure resource base normalizes to the v1 surface', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.6-terra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-terra',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/v1/responses')
})

test('auto-routed responses on the Azure v1 base appends /responses without rewriting the path', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.6-luna',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-luna',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/v1/responses')
})

test('Azure responses URL normalization drops a configured query string', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/v1?api-version=2024-12-01-preview'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(JSON.stringify({
      id: 'resp-1', model: 'gpt-5.6-sol',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({ model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hello' }], max_tokens: 64, stream: false })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/v1/responses')
})

test('Azure responses URL normalization drops a query string after a trailing slash', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/v1/?api-version=2024-12-01-preview'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(JSON.stringify({
      id: 'resp-1', model: 'gpt-5.6-sol',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({ model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hello' }], max_tokens: 64, stream: false })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/v1/responses')
})

test('Azure chat-completions URL normalization drops a configured query string', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/v1?api-version=2024-12-01-preview'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_API_FORMAT = 'chat_completions'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(JSON.stringify({
      id: 'chatcmpl-1', model: 'gpt-5.6-sol',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({ model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hello' }], max_tokens: 64, stream: false })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/deployments/gpt-5.6-sol/chat/completions?api-version=2024-12-01-preview')
})

test('auto-routed responses on an Azure /deployments/ base strips the deployment and uses the v1 surface', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/deployments/my-gpt56'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.6-sol',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/v1/responses')
})

test('OPENAI_AZURE_STYLE routes gpt-5.6 on a custom base to {base}/openai/v1/responses', async () => {
  process.env.OPENAI_BASE_URL = 'https://apim.contoso.example/azure-openai'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_AZURE_STYLE = '1'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.6-sol',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://apim.contoso.example/azure-openai/openai/v1/responses')
})

test('Azure responses URL normalization strips stacked v1 and deployment suffixes', async () => {
  process.env.OPENAI_BASE_URL =
    'https://myres.openai.azure.com/openai/deployments/my-gpt56/openai/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.6-terra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-terra',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/v1/responses')
})

test('explicit OPENAI_API_FORMAT=responses works for arbitrary Azure deployment names', async () => {
  // Azure deployment names are arbitrary, so the model-name auto-route cannot
  // recognize them; the documented path is the explicit responses format.
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_API_FORMAT = 'responses'
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'production-coding',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'production-coding',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://myres.openai.azure.com/openai/v1/responses')
  expect(capturedBody?.model).toBe('production-coding')
})

test('arbitrary Azure deployment names stay on chat/completions without the explicit format', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''

  globalThis.fetch = (async (input, _init) => {
    capturedUrl = String(input)
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'production-coding',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'production-coding',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe(
    'https://myres.openai.azure.com/openai/deployments/production-coding/chat/completions?api-version=2024-12-01-preview',
  )
})

test('auto-routed gpt-5.6 on an Azure base nests reasoning.effort and the encrypted-content include', async () => {
  process.env.OPENAI_BASE_URL = 'https://myres.openai.azure.com/openai/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.6-sol',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'high' }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl.endsWith('/openai/v1/responses')).toBe(true)
  expect(capturedBody?.reasoning).toEqual({ effort: 'high', summary: 'auto' })
  expect(capturedBody?.include).toEqual(['reasoning.encrypted_content'])
})


// openaiShim test extraction seam 014 start: strips canonical Anthropic headers from per-request shim headers too
test('strips canonical Anthropic headers from per-request shim headers too', async () => {
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 3,
          total_tokens: 11,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'gpt-4o',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    },
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-safe-header': 'keep-me',
      },
    },
  )

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('anthropic-beta')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
})
// openaiShim test extraction seam 014 end


// openaiShim test extraction seam 015 start: applies descriptor static headers before client and request headers

// openaiShim test extraction seam 015 end


// openaiShim test extraction seam 016 start: opengateway sends Accept-Encoding: identity header on chat requests

// openaiShim test extraction seam 016 end


// openaiShim test extraction seam 017 start: strips Anthropic-specific headers on GitHub Codex transport requests

// openaiShim test extraction seam 017 end


// openaiShim test extraction seam 018 start: uses direct GitHub Copilot Enterprise key for shim authentication

// openaiShim test extraction seam 018 end


// openaiShim test extraction seam 019 start: direct GitHub Copilot key wins over stale OpenAI key

// openaiShim test extraction seam 019 end


// openaiShim test extraction seam 020 start: strips Anthropic-specific headers on GitHub Codex transport with providerOverride API key

// openaiShim test extraction seam 020 end


// openaiShim test extraction seam 021 start: preserves usage from final OpenAI stream chunk with empty choices
test('preserves usage from final OpenAI stream chunk with empty choices', async () => {
  globalThis.fetch = (async (_input, init) => {
    const url = typeof _input === 'string' ? _input : _input.url
    expect(url).toBe('http://example.test/v1/chat/completions')

    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })

    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'hello world' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [],
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          total_tokens: 168,
        },
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const usageEvent = events.find(
    event => event.type === 'message_delta' && typeof event.usage === 'object' && event.usage !== null,
  ) as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined

  expect(usageEvent).toBeDefined()
  expect(usageEvent?.usage?.input_tokens).toBe(123)
  expect(usageEvent?.usage?.output_tokens).toBe(45)
})
// openaiShim test extraction seam 021 end


// Extraction seam: stream conversion usage | shared stream control.

// openaiShim test extraction seam 022 start: readWithIdleTimeout rejects quickly and cancels a stalled reader
test('readWithIdleTimeout rejects quickly and cancels a stalled reader', async () => {
  const testApi = await getStreamIdleTestApi('stream-idle-helper')
  const cancelReasons: unknown[] = []
  const reader = new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelReasons.push(reason)
    },
  }).getReader()

  const startedAt = Date.now()
  let caught: unknown
  try {
    await testApi.readWithIdleTimeout(reader, 20)
  } catch (error) {
    caught = error
  }

  expect(Date.now() - startedAt).toBeLessThan(500)
  expect(caught).toBeInstanceOf(testApi.StreamIdleTimeoutError)
  expect((caught as Error).name).toBe('StreamIdleTimeoutError')
  expect(cancelReasons).toHaveLength(1)
  expect(cancelReasons[0]).toBeInstanceOf(testApi.StreamIdleTimeoutError)
})
// openaiShim test extraction seam 022 end


// openaiShim test extraction seam 023 start: readWithIdleTimeout preserves parent abort instead of reporting idle timeout
test('readWithIdleTimeout preserves parent abort instead of reporting idle timeout', async () => {
  const testApi = await getStreamIdleTestApi('stream-idle-user-abort')
  const parent = new AbortController()
  const cancelReasons: unknown[] = []
  const reader = new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelReasons.push(reason)
    },
  }).getReader()

  const read = testApi.readWithIdleTimeout(reader, 1_000, {
    signal: parent.signal,
  })
  parent.abort()

  let caught: unknown
  try {
    await read
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(DOMException)
  expect((caught as DOMException).name).toBe('AbortError')
  expect(cancelReasons).toHaveLength(1)
  expect(cancelReasons[0]).toBeInstanceOf(DOMException)
  expect((cancelReasons[0] as DOMException).name).toBe('AbortError')
})
// openaiShim test extraction seam 023 end


// openaiShim test extraction seam 024 start: stream idle timeout env parser parses and bounds overrides
test('stream idle timeout env parser parses and bounds overrides', async () => {
  const testApi = await getStreamIdleTestApi('stream-idle-env-parser')

  delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS
  expect(testApi.getStreamIdleTimeoutMs()).toBe(90_000)

  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '25'
  expect(testApi.getStreamIdleTimeoutMs()).toBe(25)

  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = ' 25 '
  expect(testApi.getStreamIdleTimeoutMs()).toBe(25)

  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '3000000000'
  expect(testApi.getStreamIdleTimeoutMs()).toBe(2_147_483_647)

  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '9007199254740993'
  expect(testApi.getStreamIdleTimeoutMs()).toBe(90_000)

  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '25ms'
  expect(testApi.getStreamIdleTimeoutMs()).toBe(90_000)

  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '0'
  expect(testApi.getStreamIdleTimeoutMs()).toBe(90_000)

  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '-5'
  expect(testApi.getStreamIdleTimeoutMs()).toBe(90_000)
})
// openaiShim test extraction seam 024 end


// openaiShim test extraction seam 025 start: Anthropic-compatible passthrough stream rejects with idle timeout when it stalls
test('Anthropic-compatible passthrough stream rejects with idle timeout when it stalls', async () => {
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '25'
  const stalled = makeStallingResponse(
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_idle_passthrough',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'passthrough-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })}\n\n`,
    'https://api.anthropic-shaped.example.com/v1/messages',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'passthrough-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  let caught: unknown
  try {
    for await (const _event of result.data) {
      // drain until the stalled reader times out
    }
  } catch (error) {
    caught = error
  } finally {
    stalled.close()
  }

  expect((caught as Error).name).toBe('StreamIdleTimeoutError')
  expect((stalled.cancelReasons[0] as Error).name).toBe('StreamIdleTimeoutError')
})
// openaiShim test extraction seam 025 end


// Extraction seam: shared stream control | Gemini stream conversion.

// openaiShim test extraction seam 026 start: Gemini SSE stream rejects with idle timeout when it stalls
test('Gemini SSE stream rejects with idle timeout when it stalls', async () => {
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '25'
  const stalled = makeStallingResponse(
    `data: ${JSON.stringify({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'partial' }],
          },
        },
      ],
    })}\n\n`,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  let caught: unknown
  try {
    for await (const _event of result.data) {
      // drain until the stalled reader times out
    }
  } catch (error) {
    caught = error
  } finally {
    stalled.close()
  }

  expect((caught as Error).name).toBe('StreamIdleTimeoutError')
  expect((stalled.cancelReasons[0] as Error).name).toBe('StreamIdleTimeoutError')
})
// openaiShim test extraction seam 026 end


// openaiShim test extraction seam 027 start: OpenAI-compatible stream rejects with idle timeout when it stalls after a chunk

// openaiShim test extraction seam 027 end


// openaiShim test extraction seam 028 start: OpenAI-compatible stream keeps slow active chunks alive under the idle timeout

// openaiShim test extraction seam 028 end


// openaiShim test extraction seam 029 start: controller abort reaches generic OpenAI SSE converter
test('controller abort reaches generic OpenAI SSE converter', async () => {
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'partial' }),
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    const outcome = await expectAbortStopsStream({
      abort: () => stream.controller.abort(),
      cancelReasons: stalled.cancelReasons,
      expectedEventsBeforeAbort: 3,
      label: 'generic OpenAI SSE stream',
      stream,
    })

    expect(outcome.events.some(event => event.type === 'content_block_delta')).toBe(true)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 029 end


// openaiShim test extraction seam 030 start: controller abort cancels generic OpenAI SSE before iteration starts
test('controller abort cancels generic OpenAI SSE before iteration starts', async () => {
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'partial' }),
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    stream.controller.abort()
    await waitForPromise(
      (async () => {
        for (let i = 0; i < 10; i++) {
          if (stalled.cancelReasons.length > 0) return
          await Promise.resolve()
        }
        throw new Error('pre-iteration OpenAI SSE stream did not cancel source')
      })(),
      500,
      'pre-iteration OpenAI SSE stream did not cancel source',
    )
    expect(stalled.cancelReasons).toHaveLength(1)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 030 end


// openaiShim test extraction seam 031 start: controller abort cancels generic OpenAI SSE when paused after message_start
test('controller abort cancels generic OpenAI SSE when paused after message_start', async () => {
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'partial' }),
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    await expectPausedAbortCancelsStream({
      cancelReasons: stalled.cancelReasons,
      label: 'paused generic OpenAI SSE stream',
      stream,
    })
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 031 end


// openaiShim test extraction seam 032 start: controller abort stops buffered generic OpenAI SSE events
test('controller abort stops buffered generic OpenAI SSE events', async () => {
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'first' }) +
      makeOpenAIStreamFrame({ content: 'second' }),
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    await expectBufferedAbortRejectsNext({
      expectedText: 'first',
      label: 'buffered generic OpenAI SSE stream',
      stream,
    })
    expect(stalled.cancelReasons).toHaveLength(1)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 032 end


// openaiShim test extraction seam 033 start: controller abort reaches Anthropic messages SSE passthrough
test('controller abort reaches Anthropic messages SSE passthrough', async () => {
  const stalled = makeStallingResponse(
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_passthrough_abort',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'passthrough-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })}\n\n`,
    'https://api.anthropic-shaped.example.com/v1/messages',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'passthrough-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    const outcome = await expectAbortStopsStream({
      abort: () => stream.controller.abort(),
      cancelReasons: stalled.cancelReasons,
      expectedEventsBeforeAbort: 1,
      label: 'Anthropic messages passthrough stream',
      stream,
    })

    expect(outcome.events[0]?.type).toBe('message_start')
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 033 end


// openaiShim test extraction seam 034 start: controller abort cancels Anthropic messages SSE when paused after event
test('controller abort cancels Anthropic messages SSE when paused after event', async () => {
  const stalled = makeStallingResponse(
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_paused_passthrough_abort',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'passthrough-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })}\n\n`,
    'https://api.anthropic-shaped.example.com/v1/messages',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'passthrough-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    await expectPausedAbortCancelsStream({
      cancelReasons: stalled.cancelReasons,
      label: 'paused Anthropic messages passthrough stream',
      stream,
    })
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 034 end


// openaiShim test extraction seam 035 start: controller abort stops buffered Anthropic messages SSE events
test('controller abort stops buffered Anthropic messages SSE events', async () => {
  const stalled = makeStallingResponse(
    [
      `data: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: 'msg_buffered_passthrough_abort',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'passthrough-model',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })}`,
      '',
      `data: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })}`,
      '',
      '',
    ].join('\n'),
    'https://api.anthropic-shaped.example.com/v1/messages',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'passthrough-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream
  const iterator = stream[Symbol.asyncIterator]()

  try {
    const first = await waitForPromise(
      iterator.next(),
      500,
      'buffered Anthropic messages passthrough did not produce first event',
    )
    expect(first.done).toBe(false)
    expect(first.value?.type).toBe('message_start')

    stream.controller.abort()
    const afterAbort = await waitForPromise(
      iterator.next().then(
        value => ({ status: 'resolved' as const, value }),
        error => ({ status: 'rejected' as const, error }),
      ),
      500,
      'buffered Anthropic messages passthrough did not stop after abort',
    )

    if (afterAbort.status !== 'rejected') {
      throw new Error(`buffered Anthropic messages passthrough yielded after abort: ${JSON.stringify(afterAbort.value)}`)
    }
    expect((afterAbort.error as { name?: unknown }).name).toBe('AbortError')
    expect(stalled.cancelReasons).toHaveLength(1)
  } finally {
    await Promise.resolve(iterator.return?.()).catch(() => {})
    stalled.close()
  }
})
// openaiShim test extraction seam 035 end


// openaiShim test extraction seam 036 start: parent signal abort still reaches OpenAI SSE converter
test('parent signal abort still reaches OpenAI SSE converter', async () => {
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'partial' }),
  )
  const parent = new AbortController()

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create(
      {
        model: 'fake-model',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        stream: true,
      },
      { signal: parent.signal },
    )
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    const outcome = await expectAbortStopsStream({
      abort: () => parent.abort(),
      cancelReasons: stalled.cancelReasons,
      expectedEventsBeforeAbort: 3,
      label: 'parent-aborted OpenAI SSE stream',
      stream,
    })

    expect(outcome.events.some(event => event.type === 'content_block_delta')).toBe(true)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 036 end


// openaiShim test extraction seam 037 start: parent signal abort cancels OpenAI SSE before iteration starts
test('parent signal abort cancels OpenAI SSE before iteration starts', async () => {
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'partial' }),
  )
  const parent = new AbortController()

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create(
      {
        model: 'fake-model',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        stream: true,
      },
      { signal: parent.signal },
    )
    .withResponse()
  expect(result.data).toBeDefined()

  try {
    parent.abort()
    await waitForPromise(
      (async () => {
        for (let i = 0; i < 10; i++) {
          if (stalled.cancelReasons.length > 0) return
          await Promise.resolve()
        }
        throw new Error('pre-iteration parent-aborted OpenAI SSE stream did not cancel source')
      })(),
      500,
      'pre-iteration parent-aborted OpenAI SSE stream did not cancel source',
    )
    expect(stalled.cancelReasons).toHaveLength(1)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 037 end


// openaiShim test extraction seam 038 start: controller abort reaches Codex responses stream converter
test('controller abort reaches Codex responses stream converter', async () => {
  const stalled = makeStallingResponse(
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: 'partial' })}\n\n`,
    'https://api.example.test/v1/responses',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    const outcome = await expectAbortStopsStream({
      abort: () => stream.controller.abort(),
      cancelReasons: stalled.cancelReasons,
      expectedEventsBeforeAbort: 3,
      label: 'Codex responses stream',
      stream,
    })

    expect(outcome.events.some(event => event.type === 'content_block_delta')).toBe(true)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 038 end


// openaiShim test extraction seam 039 start: controller abort cancels Codex responses stream when paused after message_start
test('controller abort cancels Codex responses stream when paused after message_start', async () => {
  const stalled = makeStallingResponse(
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: 'partial' })}\n\n`,
    'https://api.example.test/v1/responses',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    await expectPausedAbortCancelsStream({
      cancelReasons: stalled.cancelReasons,
      label: 'paused Codex responses stream',
      stream,
    })
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 039 end


// openaiShim test extraction seam 040 start: controller abort reaches Gemini SSE converter
test('controller abort reaches Gemini SSE converter', async () => {
  const stalled = makeStallingResponse(
    `data: ${JSON.stringify({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'partial' }],
          },
        },
      ],
    })}\n\n`,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    const outcome = await expectAbortStopsStream({
      abort: () => stream.controller.abort(),
      cancelReasons: stalled.cancelReasons,
      expectedEventsBeforeAbort: 3,
      label: 'Gemini SSE stream',
      stream,
    })

    expect(outcome.events.some(event => event.type === 'content_block_delta')).toBe(true)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 040 end


// openaiShim test extraction seam 041 start: controller abort stops buffered Gemini SSE events
test('controller abort stops buffered Gemini SSE events', async () => {
  const makeGeminiFrame = (text: string) =>
    `data: ${JSON.stringify({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text }],
          },
        },
      ],
    })}\n\n`
  const stalled = makeStallingResponse(
    makeGeminiFrame('first') + makeGeminiFrame('second'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse',
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()
  const stream = result.data as unknown as ShimStream

  try {
    await expectBufferedAbortRejectsNext({
      expectedText: 'first',
      label: 'buffered Gemini SSE stream',
      stream,
    })
    expect(stalled.cancelReasons).toHaveLength(1)
  } finally {
    stalled.close()
  }
})
// openaiShim test extraction seam 041 end


// Extraction seam: Gemini stream conversion | native Ollama stream adaptation.

// openaiShim test extraction seam 042 start: controller abort reaches native Ollama converted stream
test('controller abort reaches native Ollama converted stream', async () => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL
  let stalled: StallingResponse | undefined

  try {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    stalled = makeStallingResponse(
      `${JSON.stringify({
        model: 'llama3.1:8b',
        message: { role: 'assistant', content: 'partial' },
        done: false,
      })}\n`,
      'http://localhost:11434/api/chat',
      'application/x-ndjson',
    )
    const activeStalled = stalled

    globalThis.fetch = (async () => activeStalled.response) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'llama3.1:8b',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()
    const stream = result.data as unknown as ShimStream

    const outcome = await expectAbortStopsStream({
      abort: () => stream.controller.abort(),
      cancelReasons: activeStalled.cancelReasons,
      expectedEventsBeforeAbort: 1,
      label: 'native Ollama converted stream',
      stream,
    })

    expect(outcome.events[0]?.type).toBe('message_start')
  } finally {
    stalled?.close()
    restoreEnv('OPENAI_BASE_URL', previousBaseUrl)
  }
})
// openaiShim test extraction seam 042 end


// openaiShim test extraction seam 043 start: normal OpenAI SSE stream still completes after controller wiring
test('normal OpenAI SSE stream still completes after controller wiring', async () => {
  globalThis.fetch = (async () =>
    makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-normal-stream',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'complete' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-normal-stream',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ]))) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe('complete')
  expect((result.data as unknown as ShimStream).controller.signal.aborted).toBe(false)
})
// openaiShim test extraction seam 043 end


// openaiShim test extraction seam 044 start: uses max_tokens instead of max_completion_tokens for local providers
test('uses max_tokens instead of max_completion_tokens for local providers', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.options?.num_predict).toBe(64)
    expect(body.options?.num_ctx).toBe(32768)
    expect(body.stream_options).toBeUndefined()

    return new Response(
      JSON.stringify({
        model: 'llama3.1:8b',
        message: {
          role: 'assistant',
          content: 'hello',
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 5,
        eval_count: 1,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'llama3.1:8b',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })
})
// openaiShim test extraction seam 044 end


// openaiShim test extraction seam 045 start: keeps max_completion_tokens for non-local non-github providers

// openaiShim test extraction seam 045 end


// openaiShim test extraction seam 046 start: uses route-specific credential env vars for descriptor-backed openai-compatible routes

// openaiShim test extraction seam 046 end


// openaiShim test extraction seam 047 start: preserves Gemini tool call extra_content in follow-up requests
test('preserves Gemini tool call extra_content in follow-up requests', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Use Bash' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'pwd' },
            extra_content: {
              google: {
                thought_signature: 'sig-123',
              },
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'D:\\repo',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  ) as { tool_calls?: Array<Record<string, unknown>> } | undefined

  expect(assistantWithToolCall?.tool_calls?.[0]).toMatchObject({
    id: 'call_1',
    type: 'function',
    function: {
      name: 'Bash',
      arguments: JSON.stringify({ command: 'pwd' }),
    },
    extra_content: {
      google: {
        thought_signature: 'sig-123',
      },
    },
  })
})
// openaiShim test extraction seam 047 end


// openaiShim test extraction seam 048 start: replays Gemini tool signatures for OpenGateway Gemini models
test('replays Gemini tool signatures for OpenGateway Gemini models', async () => {
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'google/gemini-3.1-flash-lite',
    messages: [
      { role: 'user', content: 'Use Write' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Write',
            input: { file_path: 'todo.md', content: 'todo' },
            signature: 'sig-opengateway',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'created',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  ) as { tool_calls?: Array<Record<string, unknown>> } | undefined

  expect(assistantWithToolCall?.tool_calls?.[0]).toMatchObject({
    id: 'call_1',
    extra_content: {
      google: {
        thought_signature: 'sig-opengateway',
      },
    },
  })
})
// openaiShim test extraction seam 048 end


// openaiShim test extraction seam 049 start: OpenGateway MiMo replays real reasoning_content without adding empty fallback

// openaiShim test extraction seam 049 end


// openaiShim test extraction seam 050 start: Xiaomi MiMo replays real reasoning_content without adding empty fallback

// openaiShim test extraction seam 050 end


// openaiShim test extraction seam 051 start: OpenGateway MiMo does not synthesize empty reasoning_content when missing

// openaiShim test extraction seam 051 end


// openaiShim test extraction seam 052 start: strips unsupported stream_options for Xiaomi MiMo streams

// openaiShim test extraction seam 052 end


// openaiShim test extraction seam 053 start: preserves Grep tool pattern field in OpenAI-compatible schemas
test('preserves Grep tool pattern field in OpenAI-compatible schemas', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-grep-schema',
        model: 'qwen/qwen3.6-plus',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'qwen/qwen3.6-plus',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Grep' }],
    tools: [
      {
        name: 'Grep',
        description: 'Search file contents',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            path: { type: 'string' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const tools = requestBody?.tools as Array<Record<string, unknown>> | undefined
  const grepTool = tools?.find(tool => (tool.function as Record<string, unknown>)?.name === 'Grep') as
    | { function?: { parameters?: { properties?: Record<string, unknown>; required?: string[] } } }
    | undefined

  expect(Object.keys(grepTool?.function?.parameters?.properties ?? {})).toContain('pattern')
  expect(grepTool?.function?.parameters?.required).toContain('pattern')
})
// openaiShim test extraction seam 053 end


// openaiShim test extraction seam 054 start: does not infer Gemini mode from OPENAI_BASE_URL path substrings
test('does not infer Gemini mode from OPENAI_BASE_URL path substrings', async () => {
  let capturedAuthorization: string | null = null

  process.env.OPENAI_BASE_URL =
    'https://evil.example/generativelanguage.googleapis.com/v1beta/openai'
  delete process.env.OPENAI_API_KEY
  process.env.GEMINI_API_KEY = 'gemini-secret'

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'fake-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'fake-model',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
})
// openaiShim test extraction seam 054 end


// openaiShim test extraction seam 055 start: the OpenAI shim façade exposes the beta.messages namespace
test('the OpenAI shim façade exposes the beta.messages namespace', () => {
  const client = createOpenAIShimClient({}) as OpenAIShimClient
  expect(client.beta.messages).toBeDefined()
})
// openaiShim test extraction seam 055 end


// openaiShim test extraction seam 056 start: preserves image tool results as placeholders in follow-up requests
test('preserves image tool results as placeholders in follow-up requests', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'qwen/qwen3.6-plus',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'qwen/qwen3.6-plus',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Read this screenshot' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_image_1',
            name: 'Read',
            input: { file_path: 'C:\\temp\\screenshot.png' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_image_1',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'ZmFrZQ==',
                },
              },
            ],
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const toolMessage = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => message.role === 'tool',
  ) as {
    content?: Array<{
      type: string
      text?: string
      image_url?: { url: string }
    }> | string
  } | undefined

  expect(Array.isArray(toolMessage?.content)).toBe(true)
  const parts = toolMessage?.content as Array<{
    type: string
    text?: string
    image_url?: { url: string }
  }>
  // Issue #1421: image-only tool results now get a placeholder text part
  // prepended so OpenAI-compatible providers that require a `text` field on
  // `role: "tool"` messages (e.g. Xiaomi Mimo) don't 400 with "text is not set".
  expect(parts).toEqual([
    { type: 'text', text: 'Image attached.' },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
    },
  ])
})
// openaiShim test extraction seam 056 end


// openaiShim test extraction seam 057 start: adds text part for image-only user messages
test('adds text part for image-only user messages', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'mimo-v2.5-pro',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    system: 'test system',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'ZmFrZQ==',
            },
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const userMessage = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => message.role === 'user',
  ) as {
    content?: Array<{
      type: string
      text?: string
      image_url?: { url: string }
    }>
  } | undefined

  expect(userMessage?.content).toEqual([
    { type: 'text', text: 'Image attached.' },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
    },
  ])
})
// openaiShim test extraction seam 057 end


// openaiShim test extraction seam 058 start: preserves mixed text and image tool results as multipart content
test('preserves mixed text and image tool results as multipart content', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Read this screenshot' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_image_2',
            name: 'Read',
            input: { file_path: 'C:\\temp\\screenshot.png' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_image_2',
            content: [
              { type: 'text', text: 'Screenshot captured' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'ZmFrZQ==',
                },
              },
            ],
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const toolMessage = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => message.role === 'tool',
  ) as {
    content?: Array<{
      type: string
      text?: string
      image_url?: { url: string }
    }>
  } | undefined

  expect(Array.isArray(toolMessage?.content)).toBe(true)
  const parts = toolMessage?.content ?? []
  expect(parts[0]).toEqual({ type: 'text', text: 'Screenshot captured' })
  expect(parts[1]).toEqual({
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
  })
})
// openaiShim test extraction seam 058 end


// openaiShim test extraction seam 059 start: uses GEMINI_ACCESS_TOKEN for Gemini OpenAI-compatible requests

// openaiShim test extraction seam 059 end


// openaiShim test extraction seam 060 start: uses NVIDIA_API_KEY for NVIDIA NIM requests without OPENAI_API_KEY

// openaiShim test extraction seam 060 end


// openaiShim test extraction seam 061 start: does not use stale NVIDIA_API_KEY for non-NVIDIA OpenAI-compatible routes

// openaiShim test extraction seam 061 end


// openaiShim test extraction seam 062 start: does not use MINIMAX_API_KEY for non-MiniMax OpenAI-compatible routes

// openaiShim test extraction seam 062 end


// openaiShim test extraction seam 063 start: xiaomi mimo route uses api-key auth header and max_completion_tokens

// openaiShim test extraction seam 063 end

// openaiShim test extraction seam 064 start: xiaomi mimo token plan uses raw api-key and OpenAI-compatible reasoning_effort

// openaiShim test extraction seam 064 end


// Extraction seam: requestExecutor.integration.test.ts owns parameterized cases — opencode go %s direct env routing ignores stale custom auth and uses the Anthropic Messages request contract

// openaiShim test extraction seam 065 start: opencode go messages endpoint rotates raw x-api-key credentials after rate-limit failure

// openaiShim test extraction seam 065 end


// openaiShim test extraction seam 066 start: gitlawb opengateway provider flag sends OPENGATEWAY_API_KEY as bearer auth despite stale generic base URL

// openaiShim test extraction seam 066 end


// openaiShim test extraction seam 067 start: gitlawb opengateway provider flag accepts OPENAI_API_KEY compatibility fallback

// openaiShim test extraction seam 067 end


// openaiShim test extraction seam 068 start: gitlawb opengateway provider flag sends OPENAI_API_KEY fallback despite stale generic base URL

// openaiShim test extraction seam 068 end


// openaiShim test extraction seam 069 start: gitlawb opengateway provider flag trims OPENGATEWAY_API_KEY before bearer auth

// openaiShim test extraction seam 069 end


// openaiShim test extraction seam 070 start: gitlawb opengateway provider flag ignores blank OPENGATEWAY_API_KEY and uses OPENAI_API_KEY fallback

// openaiShim test extraction seam 070 end


// openaiShim test extraction seam 071 start: gitlawb opengateway provider flag sends OPENGATEWAY_API_KEY to OPENGATEWAY_BASE_URL override

// openaiShim test extraction seam 071 end


// openaiShim test extraction seam 072 start: gitlawb opengateway provider flag sends OPENGATEWAY_API_KEY to custom OPENAI_BASE_URL fallback

// openaiShim test extraction seam 072 end


// openaiShim test extraction seam 073 start: gitlawb opengateway provider flag prefers OPENGATEWAY_API_KEY over generic OPENAI_API_KEY for custom base URL

// openaiShim test extraction seam 073 end


// openaiShim test extraction seam 074 start: gitlawb opengateway provider flag prefers OPENGATEWAY_API_KEY over generic OPENAI_API_KEYS pool

// openaiShim test extraction seam 074 end


// openaiShim test extraction seam 075 start: gitlawb opengateway provider flag uses generic OPENAI_API_KEYS pool before generic OPENAI_API_KEY fallback

// openaiShim test extraction seam 075 end


// openaiShim test extraction seam 076 start: gitlawb opengateway stored provider profile key becomes bearer auth

// openaiShim test extraction seam 076 end


// openaiShim test extraction seam 077 start: openai route still sends OPENAI_API_KEY as bearer auth

// openaiShim test extraction seam 077 end


// openaiShim test extraction seam 078 start: OPENAI_API_KEYS rejects placeholder values before sending requests

// openaiShim test extraction seam 078 end

// openaiShim test extraction seam 079 start: OPENAI_API_KEYS rotates to the next key on rate-limit failure

// openaiShim test extraction seam 079 end


// openaiShim test extraction seam 080 start: OPENAI_API_KEYS does not reuse a cooled-down key after every key is rate-limited

// openaiShim test extraction seam 080 end


// openaiShim test extraction seam 081 start: comma-separated OPENAI_API_KEY rotates to the next key on rate-limit failure

// openaiShim test extraction seam 081 end


// openaiShim test extraction seam 082 start: OPENAI_API_KEYS does not rotate through pool on provider 5xx outage

// openaiShim test extraction seam 082 end

// openaiShim test extraction seam 083 start: OPENAI_API_KEYS preserves cooldown state across client requests

// openaiShim test extraction seam 083 end


// openaiShim test extraction seam 084 start: OPENAI_API_KEYS rotates Azure api-key auth on auth failure

// openaiShim test extraction seam 084 end


// openaiShim test extraction seam 085 start: OPENAI_API_KEYS does not reuse auth-disabled credentials across client requests

// openaiShim test extraction seam 085 end


// openaiShim test extraction seam 086 start: OPENAI_API_KEYS permanently evicts 403 auth failures

// openaiShim test extraction seam 086 end

// openaiShim test extraction seam 087 start: does not use BNKR_API_KEY for non-Bankr OpenAI-compatible routes

// openaiShim test extraction seam 087 end


// openaiShim test extraction seam 088 start: preserves Gemini tool call extra_content from streaming chunks
test('preserves Gemini tool call extra_content from streaming chunks', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  extra_content: {
                    google: {
                      thought_signature: 'sig-stream',
                    },
                  },
                  function: {
                    name: 'Bash',
                    arguments: '{"command":"pwd"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined

  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'function-call-1',
    name: 'Bash',
    extra_content: {
      google: {
        thought_signature: 'sig-stream',
      },
    },
  })
})
// openaiShim test extraction seam 088 end


// openaiShim test extraction seam 089 start: preserves Gemini thought signature from streaming delta extra_content
test('preserves Gemini thought signature from streaming delta extra_content', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              extra_content: {
                google: {
                  thought_signature: 'sig-delta',
                },
              },
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Write',
                    arguments: '{"file_path":"todo.md","content":"todo"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'Use Write' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined

  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'function-call-1',
    name: 'Write',
    extra_content: {
      google: {
        thought_signature: 'sig-delta',
      },
    },
    signature: 'sig-delta',
  })
})
// openaiShim test extraction seam 089 end


// openaiShim test extraction seam 090 start: preserves Gemini thought signature from non-streaming message extra_content
test('preserves Gemini thought signature from non-streaming message extra_content', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            message: {
              role: 'assistant',
              extra_content: {
                google: {
                  thought_signature: 'sig-message',
                },
              },
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Write',
                    arguments: '{"file_path":"todo.md","content":"todo"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-flash-lite',
    messages: [{ role: 'user', content: 'Use Write' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content?.[0]).toMatchObject({
    type: 'tool_use',
    id: 'function-call-1',
    name: 'Write',
    extra_content: {
      google: {
        thought_signature: 'sig-message',
      },
    },
    signature: 'sig-message',
  })
})
// openaiShim test extraction seam 090 end


// Extraction seam: provider signature metadata | raw streaming tool fallback.

// openaiShim test extraction seam 091 start: converts Gemini raw tool-call text into streaming tool_use blocks
test('converts Gemini raw tool-call text into streaming tool_use blocks', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-raw-tool',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: 'Tool calls',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-raw-tool',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            index: 0,
            delta: {
              content:
                ' requested:\n- Write({"file_path":"style.css","content":"ul { padding: 0; }"}) [id: call79435b5a26564619b0151197]',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-raw-tool',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'Write CSS' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  expect(
    events.some(
      event =>
        event.type === 'content_block_start' &&
        (event.content_block as Record<string, unknown> | undefined)?.type ===
          'text',
    ),
  ).toBe(false)

  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      (event.content_block as Record<string, unknown> | undefined)?.type ===
        'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined
  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'call79435b5a26564619b0151197',
    name: 'Write',
  })

  const toolInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        (event.delta as Record<string, unknown> | undefined)?.type ===
          'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')
  expect(JSON.parse(toolInput)).toEqual({
    file_path: 'style.css',
    content: 'ul { padding: 0; }',
  })

  const stop = events.find(event => event.type === 'message_delta') as
    | { delta?: Record<string, unknown> }
    | undefined
  expect(stop?.delta?.stop_reason).toBe('tool_use')
})
// openaiShim test extraction seam 091 end


// Extraction seam: streaming conversion | non-streaming response conversion.

// openaiShim test extraction seam 092 start: converts Gemini raw tool-call text into non-streaming tool_use blocks
test('converts Gemini raw tool-call text into non-streaming tool_use blocks', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-raw-tool',
        model: 'google/gemini-3.1-flash-lite',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                'Tool calls requested:\n- Agent({"description":"Verify the todo list application functionality.","prompt":"Check files.","subagent_type":"verification"}) [id: call9a8b7c6d5e4f3a2b1c0d9e8f]',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-flash-lite',
    messages: [{ role: 'user', content: 'Verify' }],
    max_tokens: 64,
    stream: false,
  }) as {
    stop_reason?: string
    content?: Array<Record<string, unknown>>
  }

  expect(message.stop_reason).toBe('tool_use')
  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'call9a8b7c6d5e4f3a2b1c0d9e8f',
      name: 'Agent',
      input: {
        description: 'Verify the todo list application functionality.',
        prompt: 'Check files.',
        subagent_type: 'verification',
      },
    },
  ])
})
// openaiShim test extraction seam 092 end


// openaiShim test extraction seam 093 start: normalizes plain string Bash tool arguments from OpenAI-compatible responses

// openaiShim test extraction seam 093 end


// openaiShim test extraction seam 094 start: normalizes Bash tool arguments that are valid JSON strings

// openaiShim test extraction seam 094 end


// Extraction seam: requestExecutor.integration.test.ts owns parameterized cases — preserves malformed Bash JSON literals as parsed values in non-streaming responses: %s

// openaiShim test extraction seam 095 start: keeps terminal empty Bash tool arguments invalid in non-streaming responses

// openaiShim test extraction seam 095 end


// Extraction seam: completed tool parsing | streamed tool normalization.

// openaiShim test extraction seam 096 start: normalizes plain string Bash tool arguments in streaming responses
test('normalizes plain string Bash tool arguments in streaming responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: 'pwd',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"pwd"}')
})
// openaiShim test extraction seam 096 end


// openaiShim test extraction seam 097 start: normalizes plain string Bash tool arguments when streaming starts with an empty chunk
test('normalizes plain string Bash tool arguments when streaming starts with an empty chunk', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: 'function',
                  function: {
                    arguments: 'pwd',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"pwd"}')
})
// openaiShim test extraction seam 097 end


// openaiShim test extraction seam 098 start: normalizes plain string Bash tool arguments when streaming starts with whitespace
test('normalizes plain string Bash tool arguments when streaming starts with whitespace', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: ' ',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: 'function',
                  function: {
                    arguments: 'pwd',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":" pwd"}')
})
// openaiShim test extraction seam 098 end


// openaiShim test extraction seam 099 start: keeps terminal whitespace-only Bash arguments invalid in streaming responses
test('keeps terminal whitespace-only Bash arguments invalid in streaming responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: ' ',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{}')
})
// openaiShim test extraction seam 099 end


// openaiShim test extraction seam 100 start: normalizes streaming Bash arguments that begin with bracket syntax
test('normalizes streaming Bash arguments that begin with bracket syntax', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '[ -f package.json ] && pwd',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"[ -f package.json ] && pwd"}')
})
// openaiShim test extraction seam 100 end


// openaiShim test extraction seam 101 start: normalizes streaming Bash arguments when the first chunk is only an opening brace
test('normalizes streaming Bash arguments when the first chunk is only an opening brace', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '{',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: 'function',
                  function: {
                    arguments: ' pwd; }',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"{ pwd; }"}')
})
// openaiShim test extraction seam 101 end


// openaiShim test extraction seam 102 start: repairs truncated structured Bash JSON in streaming responses
test('repairs truncated structured Bash JSON in streaming responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '{"command":"pwd"',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"pwd"}')
})
// openaiShim test extraction seam 102 end


// openaiShim test extraction seam 103 start: does not normalize incomplete streamed Bash commands when finish_reason is length
test('does not normalize incomplete streamed Bash commands when finish_reason is length', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: 'rg --fi',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'length',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const streamedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(streamedInput).toBe('rg --fi')
})
// openaiShim test extraction seam 103 end


// openaiShim test extraction seam 104 start: repairs truncated JSON objects even without command field
test('repairs truncated JSON objects even without command field', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '{"cwd":"/tmp"',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const streamedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(streamedInput).toBe('{"cwd":"/tmp"}')
})
// openaiShim test extraction seam 104 end


// Extraction seam: streamed tool normalization | schema and tool conversion.

// openaiShim test extraction seam 105 start: preserves raw input for unknown plain string tool arguments

// openaiShim test extraction seam 105 end


// openaiShim test extraction seam 106 start: preserves parsed string input for unknown JSON string tool arguments

// openaiShim test extraction seam 106 end


// Extraction seam: argument parsing | schema sanitation.

// openaiShim test extraction seam 107 start: sanitizes malformed MCP tool schemas before sending them to OpenAI
test('sanitizes malformed MCP tool schemas before sending them to OpenAI', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 1,
          total_tokens: 11,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        name: 'mcp__clientry__create_task',
        description: 'Create a task',
        input_schema: {
          type: 'object',
          properties: {
            priority: {
              type: 'integer',
              description: 'Priority: 0=low, 1=medium, 2=high, 3=urgent',
              default: true,
              enum: [false, 0, 1, 2, 3],
            },
          },
        },
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const parameters = (
    requestBody?.tools as Array<{ function?: { parameters?: Record<string, unknown> } }>
  )?.[0]?.function?.parameters
  const properties = parameters?.properties as
    | Record<string, { default?: unknown; enum?: unknown[]; type?: string }>
    | undefined

  expect(parameters?.additionalProperties).toBe(false)
  // No required[] in the original schema → none added (optional properties must not be forced required)
  expect(parameters?.required).toEqual([])
  expect(properties?.priority?.type).toBe('integer')
  expect(properties?.priority?.enum).toEqual([0, 1, 2, 3])
  expect(properties?.priority).not.toHaveProperty('default')
})
// openaiShim test extraction seam 107 end


// openaiShim test extraction seam 108 start: optional tool properties are not added to required[] — fixes Groq/Azure 400 tool_use_failed
test('optional tool properties are not added to required[] — fixes Groq/Azure 400 tool_use_failed', async () => {
  // Regression test for: all optional properties being sent as required in strict mode,
  // causing providers like Groq to reject valid tool calls where the model omits optional args.
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-4',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'read a file' }],
    tools: [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Absolute path to file' },
            offset: { type: 'number', description: 'Line to start from' },
            limit: { type: 'number', description: 'Max lines to read' },
            pages: { type: 'string', description: 'Page range for PDFs' },
          },
          required: ['file_path'],
        },
      },
    ],
    max_tokens: 16,
    stream: false,
  })

  const parameters = (
    requestBody?.tools as Array<{ function?: { parameters?: Record<string, unknown> } }>
  )?.[0]?.function?.parameters

  expect(parameters?.required).toEqual(['file_path'])

  const required = parameters?.required as string[] | undefined
  expect(required).not.toContain('offset')
  expect(required).not.toContain('limit')
  expect(required).not.toContain('pages')
  expect(parameters?.additionalProperties).toBe(false)
})
// openaiShim test extraction seam 108 end


// Extraction seam: schema sanitation | message conversion façade.

// ---------------------------------------------------------------------------
// Extraction boundary: tool conversion | message conversion (Issue #202)
//
// Focused suites own the behavior on either side of this boundary.
// This pointer intentionally remains in the façade suite after extraction.
// It also gives independent extraction branches stable merge context.
//
// ---------------------------------------------------------------------------

// openaiShim test extraction seam 109 start: the OpenAI shim façade exposes the messages.create contract
test('the OpenAI shim façade exposes the messages.create contract', () => {
  const client = createOpenAIShimClient({}) as OpenAIShimClient
  expect(typeof client.beta.messages.create).toBe('function')
})
// openaiShim test extraction seam 109 end


function makeNonStreamResponse(content = 'ok'): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model: 'test-model',
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}

// openaiShim test extraction seam 110 start: coalesces consecutive user messages to avoid alternation errors (issue #202)
test('coalesces consecutive user messages to avoid alternation errors (issue #202)', async () => {
  let sentMessages: Array<{ role: string; content: unknown }> | undefined

  globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
    sentMessages = JSON.parse(String(init?.body)).messages
    return makeNonStreamResponse()
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'test-model',
    system: 'sys',
    messages: [
      { role: 'user', content: 'first message' },
      { role: 'user', content: 'second message' },
    ],
    max_tokens: 64,
    stream: false,
  })

  expect(sentMessages?.length).toBe(2)
  expect(sentMessages?.[0]?.role).toBe('system')
  expect(sentMessages?.[1]?.role).toBe('user')
  const userContent = sentMessages?.[1]?.content as string
  expect(userContent).toContain('first message')
  expect(userContent).toContain('second message')
})
// openaiShim test extraction seam 110 end


// openaiShim test extraction seam 111 start: coalesces consecutive assistant messages preserving tool_calls (issue #202)
test('coalesces consecutive assistant messages preserving tool_calls (issue #202)', async () => {
  let sentMessages: Array<{ role: string; content: unknown; tool_calls?: unknown[] }> | undefined

  globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
    sentMessages = JSON.parse(String(init?.body)).messages
    return makeNonStreamResponse()
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'test-model',
    system: 'sys',
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'thinking...' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file.txt' }] },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantMsgs = sentMessages?.filter(m => m.role === 'assistant')
  expect(assistantMsgs?.length).toBe(1)
  expect(assistantMsgs?.[0]?.tool_calls?.length).toBeGreaterThan(0)
})
// openaiShim test extraction seam 111 end


// ---------------------------------------------------------------------------
// Extraction boundary: message conversion | non-streaming response conversion
//
// Focused suites own the behavior on either side of this boundary.
// This pointer intentionally remains in the façade suite after extraction.
// It also gives independent extraction branches stable merge context.
//
// ---------------------------------------------------------------------------

// openaiShim test extraction seam 112 start: the OpenAI shim façade creates independent client instances
test('the OpenAI shim façade creates independent client instances', () => {
  expect(createOpenAIShimClient({})).not.toBe(createOpenAIShimClient({}))
})
// openaiShim test extraction seam 112 end


// openaiShim test extraction seam 113 start: non-streaming: reasoning_content emitted as thinking block only when content is null
test('non-streaming: reasoning_content emitted as thinking block only when content is null', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'Let me think about this step by step.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = (await client.beta.messages.create({
    model: 'glm-5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  expect(result.content).toEqual([
    { type: 'thinking', thinking: 'Let me think about this step by step.' },
  ])
})
// openaiShim test extraction seam 113 end


// openaiShim test extraction seam 114 start: non-streaming: empty string content does not fall through to reasoning_content as text
test('non-streaming: empty string content does not fall through to reasoning_content as text', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              reasoning_content: 'Chain of thought here.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = (await client.beta.messages.create({
    model: 'glm-5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  expect(result.content).toEqual([
    { type: 'thinking', thinking: 'Chain of thought here.' },
  ])
})
// openaiShim test extraction seam 114 end


// openaiShim test extraction seam 115 start: non-streaming: real content takes precedence over reasoning_content
test('non-streaming: real content takes precedence over reasoning_content', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'I need to calculate this.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = (await client.beta.messages.create({
    model: 'glm-5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  expect(result.content).toEqual([
    { type: 'thinking', thinking: 'I need to calculate this.' },
    { type: 'text', text: 'The answer is 42.' },
  ])
})
// openaiShim test extraction seam 115 end


// openaiShim test extraction seam 116 start: non-streaming: preserves response body when usage parsing fails

// openaiShim test extraction seam 116 end


// openaiShim test extraction seam 117 start: non-streaming: preserves response.url routing metadata after body read

// openaiShim test extraction seam 117 end


// openaiShim test extraction seam 118 start: non-streaming: strips <think> tag block from assistant content
test('non-streaming: strips <think> tag block from assistant content', async () => {
  globalThis.fetch = asMockFetch(mock(async () => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                '<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }))

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = (await client.beta.messages.create({
    model: 'gpt-5-mini',
    system: 'test system',
    messages: [{ role: 'user', content: 'hey' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  expect(result.content).toEqual([
    { type: 'text', text: 'Hey! How can I help you today?' },
  ])
})
// openaiShim test extraction seam 118 end


// Extraction seam: non-streaming response conversion | streaming event conversion.

// openaiShim test extraction seam 119 start: streaming: thinking block closed before tool call
test('streaming: thinking block closed before tool call', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', reasoning_content: 'Thinking...' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '{"command":"ls"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'glm-5',
      system: 'test system',
      messages: [{ role: 'user', content: 'Run ls' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const types = events.map(e => e.type)

  const thinkingStartIdx = types.indexOf('content_block_start')
  const firstStopIdx = types.indexOf('content_block_stop')
  const toolStartIdx = types.indexOf(
    'content_block_start',
    thinkingStartIdx + 1,
  )

  expect(thinkingStartIdx).toBeGreaterThanOrEqual(0)
  expect(firstStopIdx).toBeGreaterThan(thinkingStartIdx)
  expect(toolStartIdx).toBeGreaterThan(firstStopIdx)

  const thinkingStart = events[thinkingStartIdx] as {
    content_block?: Record<string, unknown>
  }
  expect(thinkingStart?.content_block?.type).toBe('thinking')
})
// openaiShim test extraction seam 119 end


// openaiShim test extraction seam 120 start: streaming: strips <think> tag block from assistant content deltas
test('streaming: strips <think> tag block from assistant content deltas', async () => {
  globalThis.fetch = asMockFetch(mock(async () => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content:
                '<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }))

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'gpt-5-mini',
      system: 'test system',
      messages: [{ role: 'user', content: 'hey' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe('Hey! How can I help you today?')
})
// openaiShim test extraction seam 120 end


// openaiShim test extraction seam 121 start: streaming: strips <think> tag split across multiple content chunks
test('streaming: strips <think> tag split across multiple content chunks', async () => {
  globalThis.fetch = asMockFetch(mock(async () => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '<think>user wants a greeting,',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              content: ' respond briefly</th',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              content: 'ink>Hey! How can I help you today?',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }))

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'gpt-5-mini',
      system: 'test system',
      messages: [{ role: 'user', content: 'hey' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe('Hey! How can I help you today?')
})
// openaiShim test extraction seam 121 end


// openaiShim test extraction seam 122 start: streaming: preserves prose without tags (no phrase-based false positive)
test('streaming: preserves prose without tags (no phrase-based false positive)', async () => {
  // Regression: older phrase-based sanitizer would strip "I should..." prose.
  // The tag-based approach leaves legitimate assistant output alone.
  globalThis.fetch = asMockFetch(mock(async () => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content:
                'I should note that the user role requires a briefly concise friendly response format.',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }))

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'gpt-5-mini',
      system: 'test system',
      messages: [{ role: 'user', content: 'hey' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe(
    'I should note that the user role requires a briefly concise friendly response format.',
  )
})
// openaiShim test extraction seam 122 end


// Extraction boundary: response conversion | executor network behavior.
// The executor suite owns the contiguous network-classification block below.
// Keep this marker stable for independent adjacent test migrations.
// openaiShim test extraction seam 123 start: strips credentials and query params from URL in fetch network error message

// openaiShim test extraction seam 123 end


// openaiShim test extraction seam 124 start: classifies localhost transport failures with actionable category marker

// openaiShim test extraction seam 124 end


// openaiShim test extraction seam 125 start: transport failures are not labeled with HTTP status 503

// openaiShim test extraction seam 125 end


// openaiShim test extraction seam 126 start: propagates AbortError without wrapping it as transport failure

// openaiShim test extraction seam 126 end


// openaiShim test extraction seam 127 start: classifies chat-completions endpoint 404 failures with endpoint_not_found marker

// openaiShim test extraction seam 127 end

// openaiShim test extraction seam 128 start: self-heals localhost resolution failures by retrying local loopback base URL

// openaiShim test extraction seam 128 end


// Extraction boundary: executor network behavior | native Ollama routing.
// Native Ollama endpoint selection remains an adapter/facade integration concern.
// Keep this marker stable for independent adjacent test migrations.
// openaiShim test extraction seam 129 start: uses native Ollama chat endpoint when local base URL omits /v1
test('uses native Ollama chat endpoint when local base URL omits /v1', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434'

  const requestUrls: string[] = []
  globalThis.fetch = (async (input, _init) => {
    const url = typeof input === 'string' ? input : input.url
    requestUrls.push(url)

    return new Response(
      JSON.stringify({
        model: 'qwen2.5-coder:7b',
        message: {
          role: 'assistant',
          content: 'hello from native Ollama',
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 5,
        eval_count: 2,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).resolves.toBeDefined()

  expect(requestUrls).toEqual(['http://localhost:11434/api/chat'])
})
// openaiShim test extraction seam 129 end


// openaiShim test extraction seam 130 start: keeps remote Ollama-named gateways on chat completions

// openaiShim test extraction seam 130 end


// openaiShim test extraction seam 131 start: keeps HTTPS localhost Ollama-port proxies on chat completions

// openaiShim test extraction seam 131 end


// Extraction boundary: native Ollama routing | executor tool self-healing.
// The single retry test below moves with request execution.
// Keep this marker stable for independent adjacent test migrations.
// openaiShim test extraction seam 132 start: self-heals tool-call incompatibility by retrying local Ollama requests without tools

// openaiShim test extraction seam 132 end


// Extraction boundary: executor tool self-healing | message conversion.
// Message-history normalization below belongs to the message converter.
// Keep this marker stable for independent adjacent test migrations.
// openaiShim test extraction seam 133 start: preserves valid tool_result and drops orphan tool_result
test('preserves valid tool_result and drops orphan tool_result', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'mistral-large-latest',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mistral-large-latest',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Search and then I will interrupt' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'valid_call_1',
            name: 'Search',
            input: { query: 'openclaude' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'valid_call_1',
            content: 'Found it!',
          },
          {
            type: 'tool_result',
            tool_use_id: 'orphan_call_2',
            content: 'Interrupted result',
          },
          {
            role: 'user',
            content: 'What happened?',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>

  // Should have: system, user, assistant (tool_use), tool (valid_call_1), user
  // Should NOT have: tool (orphan_call_2)

  const toolMessages = messages.filter(m => m.role === 'tool')
  expect(toolMessages.length).toBe(1)
  expect(toolMessages[0].tool_call_id).toBe('valid_call_1')

  const orphanMessage = toolMessages.find(m => m.tool_call_id === 'orphan_call_2')
  expect(orphanMessage).toBeUndefined()
  
  // Actually, the semantic message IS injected here because the user block with orphan 
  // tool result is converted to:
  // 1. Tool result (valid_call_1) -> role 'tool'
  // 2. User content ("What happened?") -> role 'user'
  // This triggers the tool -> assistant injection.
  const assistantMessages = messages.filter(m => m.role === 'assistant')
  expect(assistantMessages.some(m => m.content === '[Tool results received]')).toBe(true)
})
// openaiShim test extraction seam 133 end


// openaiShim test extraction seam 134 start: drops empty assistant message when only thinking block was present and stripped
test('drops empty assistant message when only thinking block was present and stripped', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 123456789,
      model: 'mistral-large-latest',
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mistral-large-latest',
    messages: [
      { role: 'user', content: 'Initial' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'I am thinking...', signature: 'sig' }] },
      { role: 'user', content: 'Interrupting query' },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  // The assistant msg is dropped because thinking is stripped.
  // The two user messages are coalesced.
  expect(messages.length).toBe(1)
  expect(messages[0].role).toBe('user')
  expect(String(messages[0].content)).toContain('Initial')
  expect(String(messages[0].content)).toContain('Interrupting query')
})
// openaiShim test extraction seam 134 end


// openaiShim test extraction seam 135 start: drops empty assistant message when only redacted_thinking block was present and stripped
test('drops empty assistant message when only redacted_thinking block was present and stripped', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 123456789,
      model: 'mistral-large-latest',
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mistral-large-latest',
    messages: [
      { role: 'user', content: 'Initial' },
      { role: 'assistant', content: [{ type: 'redacted_thinking', data: '[thinking hidden]' }] },
      { role: 'user', content: 'Interrupting query' },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  // The assistant msg is dropped because redacted_thinking is stripped.
  // The two user messages are coalesced.
  expect(messages.length).toBe(1)
  expect(messages[0].role).toBe('user')
  expect(String(messages[0].content)).toContain('Initial')
  expect(String(messages[0].content)).toContain('Interrupting query')
})
// openaiShim test extraction seam 135 end


// openaiShim test extraction seam 136 start: injects semantic assistant message when tool result is followed by user message
test('injects semantic assistant message when tool result is followed by user message', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({
      id: 'chatcmpl-2',
      object: 'chat.completion',
      created: 123456789,
      model: 'mistral-large-latest',
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mistral-large-latest',
    messages: [
      { 
        role: 'assistant', 
        content: [{ type: 'tool_use', id: 'call_1', name: 'search', input: {} }] 
      },
      { 
        role: 'user', 
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'Result' }
        ] 
      },
      { role: 'user', content: 'Next user query' },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  // Roles should be: assistant (tool_calls) -> tool -> assistant (semantic) -> user
  const roles = messages.map(m => m.role)
  expect(roles).toEqual(['assistant', 'tool', 'assistant', 'user'])
  
  const semanticMsg = messages[2]
  expect(semanticMsg.role).toBe('assistant')
  expect(semanticMsg.content).toBe('[Tool results received]')
  expect(semanticMsg.content).not.toContain('interrupted')
  expect(semanticMsg.content).not.toContain('user')
})
// openaiShim test extraction seam 136 end


// Extraction boundary: executor tool self-healing | message/provider shaping.
// Provider request shaping below is not owned by the executor.
// Keep this marker stable for independent adjacent test migrations.
// openaiShim test extraction seam 137 start: Moonshot: uses max_tokens (not max_completion_tokens) and strips store

// openaiShim test extraction seam 137 end


// openaiShim test extraction seam 138 start: Cerebras: strips unsupported store on chat_completions (#1023)

// openaiShim test extraction seam 138 end


// openaiShim test extraction seam 139 start: Local provider (vLLM/Ollama/etc.): strips unsupported store on chat_completions (#672)

// openaiShim test extraction seam 139 end


// openaiShim test extraction seam 140 start: Mistral: strips unsupported store on chat_completions (#739)

// openaiShim test extraction seam 140 end


// openaiShim test extraction seam 141 start: Mistral host fallback: strips store on an unresolved Mistral-host route (#739)

// openaiShim test extraction seam 141 end


// openaiShim test extraction seam 142 start: hasMistralApiHost matches the Mistral host and its subdomains only
test('hasMistralApiHost matches the Mistral host and its subdomains only', () => {
  expect(hasMistralApiHost('https://api.mistral.ai/v1')).toBe(true)
  expect(hasMistralApiHost('https://proxy.mistral.ai/v1')).toBe(true)
  expect(hasMistralApiHost('https://eu.mistral.ai/v1')).toBe(true)
  // Non-Mistral hosts (and look-alikes) must keep `store`.
  expect(hasMistralApiHost('https://api.openai.com/v1')).toBe(false)
  expect(hasMistralApiHost('https://notmistral.ai/v1')).toBe(false)
  expect(hasMistralApiHost('https://api.mistral.ai.evil.com/v1')).toBe(false)
  expect(hasMistralApiHost(undefined)).toBe(false)
  expect(hasMistralApiHost('not a url')).toBe(false)
})
// openaiShim test extraction seam 142 end


// openaiShim test extraction seam 143 start: Groq: keeps max_completion_tokens and strips unsupported store

// openaiShim test extraction seam 143 end



// openaiShim test extraction seam 144 start: Groq: strips reasoning_effort even when compat inference matches the model

// openaiShim test extraction seam 144 end

// openaiShim test extraction seam 145 start: Moonshot: echoes reasoning_content on assistant tool-call messages

// openaiShim test extraction seam 145 end


// openaiShim test extraction seam 146 start: DeepSeek echoes reasoning_content on assistant tool-call messages

// openaiShim test extraction seam 146 end


// openaiShim test extraction seam 147 start: generic OpenAI-compatible providers do not echo reasoning_content on assistant tool-call messages

// openaiShim test extraction seam 147 end


// openaiShim test extraction seam 148 start: gateway-routed DeepSeek models inherit descriptor-backed reasoning and token shaping

// openaiShim test extraction seam 148 end


// openaiShim test extraction seam 149 start: Moonshot: cn host is also detected

// openaiShim test extraction seam 149 end


// openaiShim test extraction seam 150 start: Kimi Code endpoint inherits Moonshot max_tokens/store compatibility

// openaiShim test extraction seam 150 end


// openaiShim test extraction seam 151 start: Kimi Code endpoint echoes reasoning_content on assistant tool-call messages

// openaiShim test extraction seam 151 end


// openaiShim test extraction seam 152 start: DeepSeek sends thinking toggle and normalized reasoning effort

// openaiShim test extraction seam 152 end


// openaiShim test extraction seam 153 start: NVIDIA NIM DeepSeek sends chat template thinking kwargs
test('NVIDIA NIM DeepSeek sends chat template thinking kwargs', async () => {
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvapi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-ai/deepseek-v4-pro',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-ai/deepseek-v4-pro',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
    thinking: { type: 'enabled' },
  })

  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
  expect(requestBody?.chat_template_kwargs).toEqual({
    thinking: true,
    enable_thinking: true,
  })
})
// openaiShim test extraction seam 153 end


// openaiShim test extraction seam 154 start: NVIDIA NIM DeepSeek omits chat template thinking kwargs when thinking is disabled
test('NVIDIA NIM DeepSeek omits chat template thinking kwargs when thinking is disabled', async () => {
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvapi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-ai/deepseek-v4-pro',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-ai/deepseek-v4-pro?thinking=disabled',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.thinking).toBeUndefined()
  expect(requestBody?.reasoning_effort).toBeUndefined()
  expect(requestBody?.chat_template_kwargs).toBeUndefined()
})
// openaiShim test extraction seam 154 end


// openaiShim test extraction seam 155 start: DeepSeek omits thinking controls when the Anthropic-side request does not set them

// openaiShim test extraction seam 155 end


// openaiShim test extraction seam 156 start: DeepSeek forwards an explicit thinking disable toggle for V4 models

// openaiShim test extraction seam 156 end



// openaiShim test extraction seam 157 start: collapses multiple text blocks in tool_result to string for DeepSeek compatibility (issue #774)
test('collapses multiple text blocks in tool_result to string for DeepSeek compatibility (issue #774)', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-reasoner',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'deepseek-reasoner',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Run ls' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: [
              { type: 'text', text: 'line one' },
              { type: 'text', text: 'line two' },
            ],
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const toolMessages = messages.filter(m => m.role === 'tool')
  expect(toolMessages.length).toBe(1)
  expect(toolMessages[0].tool_call_id).toBe('call_1')
  expect(typeof toolMessages[0].content).toBe('string')
  expect(toolMessages[0].content).toBe('line one\n\nline two')
})
// openaiShim test extraction seam 157 end


// openaiShim test extraction seam 158 start: collapses multiple text blocks into a single string for DeepSeek compatibility (issue #774)
test('collapses multiple text blocks into a single string for DeepSeek compatibility (issue #774)', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-reasoner',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'deepseek-reasoner',
    system: 'test system',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello!' },
          { type: 'text', text: 'How are you?' },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  expect(messages.length).toBe(2) // system + user
  expect(messages[1].role).toBe('user')
  expect(typeof messages[1].content).toBe('string')
  expect(messages[1].content).toBe('Hello!\n\nHow are you?')
})
// openaiShim test extraction seam 158 end


// openaiShim test extraction seam 159 start: preserves mixed text and image tool results as multipart content
test('preserves mixed text and image tool results as multipart content', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Show me' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'cat image.png' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: [
              { type: 'text', text: 'Here is the image:' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgo=',
                },
              },
            ],
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const toolMessages = messages.filter(m => m.role === 'tool')
  expect(toolMessages.length).toBe(1)
  expect(Array.isArray(toolMessages[0].content)).toBe(true)
  const content = toolMessages[0].content as Array<Record<string, unknown>>
  expect(content.length).toBe(2)
  expect(content[0].type).toBe('text')
  expect(content[1].type).toBe('image_url')
})
// openaiShim test extraction seam 159 end


// openaiShim test extraction seam 160 start: Z.AI: uses max_tokens (not max_completion_tokens) and strips store

// openaiShim test extraction seam 160 end


// openaiShim test extraction seam 161 start: Z.AI: thinking mode enabled when requested

// openaiShim test extraction seam 161 end


// openaiShim test extraction seam 162 start: Z.AI GLM-5.2: default request relies on provider thinking defaults

// openaiShim test extraction seam 162 end


// openaiShim test extraction seam 163 start: Z.AI GLM-5.2: user-selected xhigh effort maps to provider max effort

// openaiShim test extraction seam 163 end


// Extraction seam: requestExecutor.integration.test.ts owns parameterized cases — Z.AI GLM-5.2: %s enables mapped reasoning effort

// Extraction seam: requestExecutor.integration.test.ts owns parameterized cases — Z.AI GLM: %s does not receive GLM-5.2-only reasoning_effort

// openaiShim test extraction seam 164 start: Z.AI GLM-5.2: model-query thinking disable omits reasoning effort

// openaiShim test extraction seam 164 end


// openaiShim test extraction seam 165 start: Z.AI GLM-5.2: per-turn thinking overrides model-query default

// openaiShim test extraction seam 165 end


// openaiShim test extraction seam 166 start: NVIDIA NIM Z.AI GLM sends chat template thinking kwargs
test('NVIDIA NIM Z.AI GLM sends chat template thinking kwargs', async () => {
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvapi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'z-ai/glm-5.2',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'z-ai/glm-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
  expect(requestBody?.chat_template_kwargs).toEqual({
    thinking: true,
    enable_thinking: true,
  })
})
// openaiShim test extraction seam 166 end


// openaiShim test extraction seam 167 start: NVIDIA NIM Z.AI GLM omits chat template thinking kwargs without a reasoning request
test('NVIDIA NIM Z.AI GLM omits chat template thinking kwargs without a reasoning request', async () => {
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvapi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'z-ai/glm-5.2',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'z-ai/glm-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.thinking).toBeUndefined()
  expect(requestBody?.reasoning_effort).toBeUndefined()
  expect(requestBody?.chat_template_kwargs).toBeUndefined()
})
// openaiShim test extraction seam 167 end


// openaiShim test extraction seam 168 start: NVIDIA NIM Z.AI GLM omits chat template thinking kwargs when thinking is disabled
test('NVIDIA NIM Z.AI GLM omits chat template thinking kwargs when thinking is disabled', async () => {
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvapi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'z-ai/glm-5.2',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'z-ai/glm-5.2?thinking=disabled',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.thinking).toEqual({ type: 'disabled' })
  expect(requestBody?.reasoning_effort).toBeUndefined()
  expect(requestBody?.chat_template_kwargs).toBeUndefined()
})
// openaiShim test extraction seam 168 end


// Extraction boundary: provider reasoning compatibility | tool-stream routing.
// The gateway emission regression below remains provider/request-shaping coverage.
// Keep this marker stable for independent adjacent test migrations.
// Regression test for #1950: GLM-5.2 served through NVIDIA NIM
// (`integrate.api.nvidia.com`) must never receive the Z.AI-proprietary
// `tool_stream` parameter. Streaming tool calls are simply not streamed on
// this gateway; sending the parameter aborts the request with
// `400 Unsupported parameter(s): tool_stream`.
// openaiShim test extraction seam 169 start: NVIDIA NIM Z.AI GLM streaming request with tools does not send tool_stream (regression #1950)

// openaiShim test extraction seam 169 end


// Extraction boundary: provider tool-stream shaping | executor tool-stream retry.
// The three retry-state tests below move together with request execution.
// Keep this marker stable for independent adjacent test migrations.
// Regression test for #1950: even if a gateway rejects `tool_stream` with a
// 400 (e.g. NVIDIA NIM: `Unsupported parameter(s): tool_stream`), the shim
// self-heals by dropping only that parameter and retrying with tools intact.
// Here we exercise the generic self-heal using a Z.AI-contract gateway that
// actually sends `tool_stream`, then rejects it — proving the retry drops the
// parameter rather than surfacing a hard error.
// openaiShim test extraction seam 170 start: Shim self-heals a JSON `tool_stream` rejection by retrying without it (#1950)

// openaiShim test extraction seam 170 end


// openaiShim test extraction seam 171 start: Shim stops after one tool_stream self-heal retry when the retry also fails (#1950)

// openaiShim test extraction seam 171 end


// openaiShim test extraction seam 172 start: Shim retries a tool_stream rejection with the same pooled credential (#1950)

// openaiShim test extraction seam 172 end


// Extraction boundary: executor tool-stream retry | provider tool-stream shaping.
// Provider emission rules below remain with compatibility/request planning.
// Keep this marker stable for independent adjacent test migrations.
// openaiShim test extraction seam 173 start: Z.AI GLM-5.2: streaming requests with tools send tool_stream

// openaiShim test extraction seam 173 end


// openaiShim test extraction seam 174 start: Hicap GLM-5.2: uses Z.AI-compatible request shaping

// openaiShim test extraction seam 174 end

// openaiShim test extraction seam 175 start: Z.AI GLM-5.2: remote tool incompatibility does not use local toolless retry

// openaiShim test extraction seam 175 end


// Extraction seam: requestExecutor.integration.test.ts owns parameterized cases — does not send tool_stream for %s

// openaiShim test extraction seam 176 start: Z.AI GLM-5.2: preserved thinking round-trips with tool calls

// openaiShim test extraction seam 176 end


// openaiShim test extraction seam 177 start: strips Anthropic attribution header block from chat-completions system prompt (#607)
test('strips Anthropic attribution header block from chat-completions system prompt (#607)', async () => {
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: [
      {
        type: 'text',
        text:
          'x-anthropic-billing-header: cc_version=0.8.0.abc123; ' +
          'cc_entrypoint=cli;',
      },
      { type: 'text', text: 'You are Claude Code, helpful assistant.' },
      { type: 'text', text: 'Project context: bun + react.' },
    ],
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  const messages = capturedBody?.messages as Array<{ role: string; content: string }>
  const sysMsg = messages.find(m => m.role === 'system')
  expect(sysMsg).toBeDefined()
  expect(sysMsg?.content).not.toContain('x-anthropic-billing-header')
  expect(sysMsg?.content).not.toContain('cc_version=')
  expect(sysMsg?.content).toContain('You are Claude Code, helpful assistant.')
  expect(sysMsg?.content).toContain('Project context: bun + react.')
})
// openaiShim test extraction seam 177 end


// openaiShim test extraction seam 178 start: strips Anthropic attribution header block from responses-API instructions (#607)
test('strips Anthropic attribution header block from responses-API instructions (#607)', async () => {
  process.env.OPENAI_API_FORMAT = 'responses'
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-5.4',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.4',
    system: [
      {
        type: 'text',
        text: 'x-anthropic-billing-header: cc_version=0.8.0.abc123; cc_entrypoint=cli;',
      },
      { type: 'text', text: 'You are Claude Code.' },
    ],
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  const instructions = capturedBody?.instructions as string
  expect(instructions).not.toContain('x-anthropic-billing-header')
  expect(instructions).not.toContain('cc_version=')
  expect(instructions).toContain('You are Claude Code.')
})
// openaiShim test extraction seam 178 end


// openaiShim test extraction seam 179 start: emits reasoning_effort on chat_completions when reasoningEffort is passed

// openaiShim test extraction seam 179 end


// openaiShim test extraction seam 180 start: omits reasoning_effort on chat_completions when no override and model has no alias default

// openaiShim test extraction seam 180 end


// openaiShim test extraction seam 181 start: emits reasoning_effort from codex alias default when no override is passed

// openaiShim test extraction seam 181 end


// openaiShim test extraction seam 182 start: DeepSeek: redacted_thinking block preserves continuity with reasoning_content: ""
test('DeepSeek: redacted_thinking block preserves continuity with reasoning_content: ""', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-chat',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-chat',
    system: 'test',
    messages: [
      { role: 'user', content: 'analyze this' },
      {
        role: 'assistant',
        content: [
          // real redacted_thinking shape: content lives in `.data`, not `.thinking`
          { type: 'redacted_thinking', data: '', signature: 'sig123' },
          { type: 'text', text: 'Analysis complete.' },
          {
            type: 'tool_use',
            id: 'call_redacted_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_redacted_1', content: 'files' },
        ],
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  // redacted_thinking is recognized as a thinking block; its .data is "" and the
  // message carries a tool_call, so it falls back to reasoning_content: ""
  expect(assistantWithToolCall?.reasoning_content).toBe('')
})
// openaiShim test extraction seam 182 end


// openaiShim test extraction seam 183 start: DeepSeek: redacted_thinking block with non-empty data propagates data into reasoning_content
test('DeepSeek: redacted_thinking block with non-empty data propagates data into reasoning_content', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-2',
        model: 'deepseek-chat',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-chat',
    system: 'test',
    messages: [
      { role: 'user', content: 'analyze this' },
      {
        role: 'assistant',
        content: [
          // real redacted_thinking with content in .data
          {
            type: 'redacted_thinking',
            data: 'encrypted_chain_of_thought_payload_v1',
            signature: 'sig456',
          },
          { type: 'text', text: 'Analysis complete.' },
          {
            type: 'tool_use',
            id: 'call_redacted_2',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_redacted_2', content: 'files' },
        ],
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  // The real .data payload must be preserved in reasoning_content — this is the
  // case the original test missed (it used a synthetic .thinking field).
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'encrypted_chain_of_thought_payload_v1',
  )
})
// openaiShim test extraction seam 183 end


// openaiShim test extraction seam 184 start: renders tool_reference blocks as text on the chat/completions path
test('renders tool_reference blocks as text on the chat/completions path', async () => {
  const { __test } = await import('./openaiShim.ts')

  const messages = __test.convertMessages(
    [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_ts1', name: 'ToolSearch', input: { query: 'memory' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_ts1',
            content: [
              { type: 'tool_reference', tool_name: 'mcp__example__memory_search' },
              { type: 'tool_reference', tool_name: 'mcp__example__memory_store' },
            ],
          },
        ],
      },
    ],
    undefined,
  )

  const toolMsg = messages.find(m => m.role === 'tool')
  expect(toolMsg).toBeDefined()
  // The rendering contract is plain text: text-only parts collapse to a string.
  expect(typeof toolMsg!.content).toBe('string')
  const content = toolMsg!.content as string
  expect(content).toContain('mcp__example__memory_search')
  expect(content).toContain('mcp__example__memory_store')
})
// openaiShim test extraction seam 184 end


// openaiShim test extraction seam 185 start: preserves valid tool pairs after history pruning while dropping orphaned tool calls
test('preserves valid tool pairs after history pruning while dropping orphaned tool calls', async () => {
  const { __test } = await import('./openaiShim.ts')

  const messages = __test.convertMessages(
    [
      { role: 'user', content: 'compacted summary of previous work' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_pruned_without_result',
            name: 'Read',
            input: { file_path: 'old.ts' },
          },
        ],
      },
      { role: 'user', content: 'continue with retained context' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading the current file.' },
          {
            type: 'tool_use',
            id: 'call_retained',
            name: 'Read',
            input: { file_path: 'current.ts' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_retained',
            content: 'current contents',
          },
        ],
      },
    ],
    undefined,
  )

  const toolCalls = messages.flatMap(message => message.tool_calls ?? [])
  expect(toolCalls.map(toolCall => toolCall.id)).toEqual(['call_retained'])

  const toolMessages = messages.filter(message => message.role === 'tool')
  expect(toolMessages).toHaveLength(1)
  expect(toolMessages[0]?.tool_call_id).toBe('call_retained')
})
// openaiShim test extraction seam 185 end


// Extraction boundary: history pruning | executor Copilot refresh behavior.
// The contiguous Copilot authentication retry block below moves with execution.
// Keep this marker stable for independent adjacent test migrations.
function makeCodexSseResponse(responseData: Record<string, unknown>): Response {
  const data = JSON.stringify(responseData)
  return makeSseResponse([`event: response.completed\ndata: ${data}\n\n`])
}

// openaiShim test extraction seam 186 start: GitHub Copilot 401 chat_completions retries with refreshed token

// openaiShim test extraction seam 186 end


// openaiShim test extraction seam 187 start: GitHub Copilot 401 codex_responses retries with refreshed token

// openaiShim test extraction seam 187 end


// openaiShim test extraction seam 188 start: GitHub Copilot 401 with credential pool uses refreshed token not pool key

// openaiShim test extraction seam 188 end


// openaiShim test extraction seam 189 start: GitHub Copilot 401 with "token has expired" triggers refresh

// openaiShim test extraction seam 189 end


// openaiShim test extraction seam 190 start: GitHub Copilot 401 without expired-token message does not trigger refresh

// openaiShim test extraction seam 190 end


// openaiShim test extraction seam 191 start: GitHub Copilot 401 refresh returning same token does not update auth

// openaiShim test extraction seam 191 end


// openaiShim test extraction seam 192 start: GitHub Copilot 401 codex_responses with providerOverride does not trigger refresh

// openaiShim test extraction seam 192 end


// openaiShim test extraction seam 193 start: GitHub Copilot 401 chat_completions with providerOverride does not trigger refresh

// openaiShim test extraction seam 193 end


// Extraction boundary: executor Copilot refresh behavior | JSON fallback conversion.
// JSON fallback response conversion below is not owned by request execution.
// Keep this marker stable for independent adjacent test migrations.
// --- JSON fallback regression tests (#1749) -------------------------------
// Some OpenAI-compatible providers ignore `stream: true` and return a full
// `application/json` chat completion. The fallback inside
// openaiStreamToAnthropic must route that response through the same
// non-streaming converter so tool_calls, Anthropic stop reasons, array
// content, and <think> stripping are all preserved (jatmn CHANGES_REQUESTED).

function makeJsonChatCompletion(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  })
}

async function collectFallbackEvents(
  body: Record<string, unknown>,
  model = 'fake-model',
): Promise<Array<Record<string, unknown>>> {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => makeJsonChatCompletion(body)) as unknown as FetchType
  try {
    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()
    const events: Array<Record<string, unknown>> = []
    for await (const event of result.data) {
      events.push(event)
    }
    return events
  } finally {
    // Restore so the global fetch stub does not leak past this helper.
    globalThis.fetch = previousFetch
  }
}

// openaiShim test extraction seam 194 start: JSON fallback: preserves tool_calls as a tool_use block

// openaiShim test extraction seam 194 end


// openaiShim test extraction seam 195 start: JSON fallback: maps finish_reason=length to max_tokens

// openaiShim test extraction seam 195 end


// openaiShim test extraction seam 196 start: JSON fallback: preserves OpenCode Go quota error guidance

// openaiShim test extraction seam 196 end


// openaiShim test extraction seam 197 start: JSON fallback: strips <think> tags from emitted text

// openaiShim test extraction seam 197 end


// openaiShim test extraction seam 198 start: JSON fallback: normalizes array content into a text string

// openaiShim test extraction seam 198 end


// openaiShim test extraction seam 199 start: JSON fallback: recovers raw-text tool call into tool_use block
test('JSON fallback: recovers raw-text tool call into tool_use block', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-raw',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          // Same "Tool calls requested:" recovery format the non-streaming
          // converter already handles (parseRawToolCallsRequestedText).
          content:
            'Tool calls requested:\n- Bash({"command":"ls"}) [id: call_raw_1]',
        },
        finish_reason: 'stop',
      },
    ],
  })
  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined
  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'call_raw_1',
    name: 'Bash',
  })
  const stopEvent = events.find(e => e.type === 'message_delta') as
    | { delta?: { stop_reason?: string } }
    | undefined
  expect(stopEvent?.delta?.stop_reason).toBe('tool_use')

})
// openaiShim test extraction seam 199 end


// openaiShim test extraction seam 200 start: JSON fallback façade terminates converted messages

// openaiShim test extraction seam 200 end


// openaiShim test extraction seam 201 start: JSON fallback: recovers Tencent HY3 text tool calls into tool_use blocks
test('JSON fallback: recovers Tencent HY3 text tool calls into tool_use blocks', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-hy3',
    model: 'tencent/hy3',
    choices: [
      {
        message: {
          role: 'assistant',
          content:
            '<tool_call:call_hy3>TaskCreate\n subject: Verify HY3\n description: Run the live test\n</tool_call:call_hy3>',
        },
        finish_reason: 'stop',
      },
    ],
  }, 'tencent/hy3')
  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined
  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    name: 'TaskCreate',
  })
  const jsonDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'input_json_delta',
  ) as { delta?: { partial_json?: string } } | undefined
  expect(JSON.parse(jsonDelta?.delta?.partial_json ?? '')).toEqual({
    subject: 'Verify HY3',
    description: 'Run the live test',
  })
  const stopEvent = events.find(e => e.type === 'message_delta') as
    | { delta?: { stop_reason?: string } }
    | undefined
  expect(stopEvent?.delta?.stop_reason).toBe('tool_use')
})
// openaiShim test extraction seam 201 end


// openaiShim test extraction seam 202 start: JSON fallback: preserves HY3-looking text for non-Tencent model names

// openaiShim test extraction seam 202 end


// openaiShim test extraction seam 203 start: JSON fallback: empty tool_calls array does not block raw-text recovery

// openaiShim test extraction seam 203 end


// openaiShim test extraction seam 204 start: JSON fallback: empty tool_calls does not block raw-text recovery on array content

// openaiShim test extraction seam 204 end

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

test('uses OpenAI-compatible responses endpoint when OPENAI_API_FORMAT=responses', async () => {
  process.env.OPENAI_API_FORMAT = 'responses'
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
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
        usage: {
          input_tokens: 8,
          output_tokens: 3,
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

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('http://example.test/v1/responses')
  expect(capturedBody?.model).toBe('gpt-5.4')
  expect(capturedBody?.instructions).toBe('test system')
  expect(capturedBody?.max_output_tokens).toBe(64)
  expect(capturedBody?.store).toBe(false)
  expect(capturedBody?.input).toEqual([
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    },
  ])
})

test('nests reasoning effort for OpenAI-compatible responses endpoint', async () => {
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
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'high' }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedBody?.reasoning).toEqual({ effort: 'high', summary: 'auto' })
  expect(capturedBody?.include).toEqual(['reasoning.encrypted_content'])
  expect(capturedBody).not.toHaveProperty('reasoning_effort')
  expect(capturedBody).not.toHaveProperty('reasoning_summary')
})

test('uses OpenAI-compatible responses endpoint with text chunk types when OPENAI_API_FORMAT=responses_compat', async () => {
  process.env.OPENAI_API_FORMAT = 'responses_compat'
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
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
        usage: {
          input_tokens: 8,
          output_tokens: 3,
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

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('http://example.test/v1/responses')
  expect(capturedBody?.model).toBe('gpt-5.4')
  expect(capturedBody?.instructions).toBe('test system')
  expect(capturedBody?.max_output_tokens).toBe(64)
  expect(capturedBody?.store).toBe(false)
  expect(capturedBody?.input).toEqual([
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    },
  ])
})

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

test('strips store from strict OpenAI-compatible responses providers', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.OPENAI_API_FORMAT = 'responses'
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'kimi-k2.5',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'kimi-k2.5',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.moonshot.ai/v1/responses')
  expect(capturedBody?.store).toBeUndefined()
})

test('strips store when providerOverride routes chat_completions to the Gemini host', async () => {
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-gemini',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    defaultHeaders: {},
    providerOverride: {
      model: 'gemini-3.1-pro',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'gemini-key',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedBody?.store).toBeUndefined()
})

test('strips store when providerOverride routes responses API to the Gemini host', async () => {
  process.env.OPENAI_API_FORMAT = 'responses'
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        id: 'resp-gemini',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    defaultHeaders: {},
    providerOverride: {
      model: 'gemini-3.1-pro',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'gemini-key',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedBody?.store).toBeUndefined()
})

test('uses custom OpenAI-compatible auth header value when configured', async () => {
  process.env.OPENAI_API_KEY = 'generic-key'
  process.env.OPENAI_AUTH_HEADER = 'api-key'
  process.env.OPENAI_AUTH_HEADER_VALUE = 'hicap-header-value'
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers as HeadersInit)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('api-key')).toBe('hicap-header-value')
  expect(capturedHeaders?.get('authorization')).toBeNull()
})

test('uses Hicap api-key auth header for the Hicap route', async () => {
  process.env.OPENAI_API_KEY = 'hicap-live-key'
  process.env.OPENAI_BASE_URL = 'https://api.hicap.ai/v1'
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers as HeadersInit)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'claude-opus-4.8',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('api-key')).toBe('hicap-live-key')
  expect(capturedHeaders?.get('authorization')).toBeNull()
})

test('defaults Authorization custom auth header to bearer scheme', async () => {
  process.env.OPENAI_API_KEY = 'authorization-key'
  process.env.OPENAI_AUTH_HEADER = 'Authorization'
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers as HeadersInit)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('authorization')).toBe('Bearer authorization-key')
})

test('honors bearer scheme for custom OpenAI-compatible auth headers', async () => {
  process.env.OPENAI_API_KEY = 'custom-key'
  process.env.OPENAI_AUTH_HEADER = 'X-Custom-Authorization'
  process.env.OPENAI_AUTH_SCHEME = 'bearer'
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers as HeadersInit)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('x-custom-authorization')).toBe('Bearer custom-key')
  expect(capturedHeaders?.get('authorization')).toBeNull()
})

test('ignores custom auth header value when no custom header is configured', async () => {
  delete process.env.OPENAI_API_KEY
  process.env.OPENAI_AUTH_HEADER_VALUE = 'gateway-header-value'
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers as HeadersInit)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('authorization')).toBeNull()
})

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

test('applies descriptor static headers before client and request headers', async () => {
  let capturedHeaders: Headers | undefined

  registerGateway({
    id: 'shim-header-test',
    label: 'Shim Header Test',
    category: 'hosted',
    defaultBaseUrl: 'https://shim-header-test.example/v1',
    defaultModel: 'shim-test-model',
    setup: {
      requiresAuth: true,
      authMode: 'api-key',
      credentialEnvVars: ['OPENAI_API_KEY'],
    },
    transportConfig: {
      kind: 'openai-compatible',
      openaiShim: {
        headers: {
          'x-static-header': 'from-descriptor',
          'x-override-header': 'from-descriptor',
        },
      },
    },
  })

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://shim-header-test.example/v1'
  process.env.OPENAI_MODEL = 'shim-test-model'

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'shim-test-model',
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
      'x-override-header': 'from-client',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'shim-test-model',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    },
    {
      headers: {
        'x-override-header': 'from-request',
      },
    },
  )

  expect(capturedHeaders?.get('x-static-header')).toBe('from-descriptor')
  expect(capturedHeaders?.get('x-override-header')).toBe('from-request')
})

test('opengateway sends Accept-Encoding: identity header on chat requests', async () => {
  let capturedHeaders: Headers | undefined

  registerGateway({
    id: 'gitlawb-opengateway-test',
    label: 'Gitlawb Opengateway',
    category: 'aggregating',
    defaultBaseUrl: 'https://opengateway.gitlawb.com/v1/xiaomi-mimo',
    defaultModel: 'mimo-v2.5-pro',
    setup: {
      requiresAuth: false,
      authMode: 'none',
    },
    transportConfig: {
      kind: 'openai-compatible',
      openaiShim: {
        headers: {
          'Accept-Encoding': 'identity',
        },
        defaultAuthHeader: {
          name: 'api-key',
          scheme: 'raw',
        },
        preserveReasoningContent: true,
        requireReasoningContentOnAssistantMessages: true,
        reasoningContentFallback: '',
        maxTokensField: 'max_completion_tokens',
        supportsApiFormatSelection: false,
        supportsAuthHeaders: false,
      },
    },
  })

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1/xiaomi-mimo'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'mimo-v2.5-pro',
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
      model: 'mimo-v2.5-pro',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    },
    {},
  )

  expect(capturedHeaders?.get('Accept-Encoding')).toBe('identity')
})

test('strips Anthropic-specific headers on GitHub Codex transport requests', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_API_KEY = 'github-test-key'
  process.env.GITHUB_TOKEN = 'stored-secret'
  delete process.env.GITHUB_COPILOT_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'github:gpt-5-codex',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    },
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-anthropic-additional-protection': 'true',
        'x-safe-header': 'keep-me',
      },
    },
  )

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('anthropic-beta')).toBeNull()
  expect(capturedHeaders?.get('x-anthropic-additional-protection')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer github-test-key')
  expect(capturedHeaders?.get('editor-plugin-version')).toBe('copilot-chat/0.26.7')
})

test('uses direct GitHub Copilot Enterprise key for shim authentication', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.GITHUB_COPILOT_KEY = 'enterprise-direct-key'
  process.env.GITHUB_ENTERPRISE_URL = 'https://github.mycompany.com'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL

  const { authorization, url } = await captureChatCompletionRequest(
    'github:gpt-4o',
  )

  expect(authorization).toBe('Bearer enterprise-direct-key')
  expect(url).toBe('https://github.mycompany.com/api/copilot/chat/completions')
})

test('direct GitHub Copilot key wins over stale OpenAI key', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.GITHUB_COPILOT_KEY = 'enterprise-direct-key'
  process.env.GITHUB_ENTERPRISE_URL = 'https://github.mycompany.com'
  process.env.OPENAI_API_KEY = 'stale-openai-key'
  delete process.env.OPENAI_BASE_URL

  const { authorization } = await captureChatCompletionRequest(
    'github:gpt-4o',
  )

  expect(authorization).toBe('Bearer enterprise-direct-key')
})

test('strips Anthropic-specific headers on GitHub Codex transport with providerOverride API key', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_API_KEY = 'env-should-not-win'
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    providerOverride: {
      model: 'github:gpt-5-codex',
      baseURL: 'https://api.githubcopilot.com',
      apiKey: 'provider-override-key',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'ignored',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    },
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-claude-remote-session-id': 'remote-123',
        'x-safe-header': 'keep-me',
      },
    },
  )

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('x-claude-remote-session-id')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer provider-override-key')
  expect(capturedHeaders?.get('editor-plugin-version')).toBe('copilot-chat/0.26.7')
})

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

test('OpenAI-compatible stream rejects with idle timeout when it stalls after a chunk', async () => {
  await getStreamIdleTestApi('stream-idle-openai-stall')
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '25'
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'partial' }),
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'glm-5.2',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  const startedAt = Date.now()
  let caught: unknown
  try {
    for await (const event of result.data) {
      events.push(event)
    }
  } catch (error) {
    caught = error
  } finally {
    stalled.close()
  }

  expect(Date.now() - startedAt).toBeLessThan(500)
  expect((caught as Error).name).toBe('StreamIdleTimeoutError')
  expect((stalled.cancelReasons[0] as Error).name).toBe('StreamIdleTimeoutError')
  const textDeltas = events.flatMap(event => {
    const eventDelta = event.delta as { type?: string; text?: string } | undefined
    return eventDelta?.type === 'text_delta' && typeof eventDelta.text === 'string'
      ? [eventDelta.text]
      : []
  })
  expect(textDeltas).toEqual(['partial'])
})

test('OpenAI-compatible stream keeps slow active chunks alive under the idle timeout', async () => {
  await getStreamIdleTestApi('stream-idle-openai-active')
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '500'
  const startedAt = Date.now()
  const encoder = new TextEncoder()
  const chunks = makeStreamChunks([
    {
      id: 'chatcmpl-active',
      object: 'chat.completion.chunk',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'hel' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-active',
      object: 'chat.completion.chunk',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          delta: { content: 'lo' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-active',
      object: 'chat.completion.chunk',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    },
  ])
  let emitTimer: ReturnType<typeof setTimeout> | undefined

  globalThis.fetch = asMockFetch(mock(async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          let index = 0
          const emit = () => {
            emitTimer = undefined
            const chunk = chunks[index++]
            if (chunk === undefined) {
              controller.close()
              return
            }
            controller.enqueue(encoder.encode(chunk))
            emitTimer = setTimeout(emit, 200)
          }
          emit()
        },
        cancel() {
          if (emitTimer !== undefined) {
            clearTimeout(emitTimer)
            emitTimer = undefined
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
        },
      },
    )))

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'glm-5.2',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const streamDelta = (event as { delta?: { type?: string; text?: string } }).delta
    if (
      streamDelta?.type === 'text_delta' &&
      typeof streamDelta.text === 'string'
    ) {
      textDeltas.push(streamDelta.text)
    }
  }

  expect(Date.now() - startedAt).toBeGreaterThan(500)
  expect(textDeltas.join('')).toBe('hello')
})

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

test('keeps max_completion_tokens for non-local non-github providers', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'

  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.max_completion_tokens).toBe(64)
    expect(body.max_tokens).toBeUndefined()

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
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
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })
})

test('uses route-specific credential env vars for descriptor-backed openai-compatible routes', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENROUTER_API_KEY = 'or-route-key'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'openai/gpt-5-mini',
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
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
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
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('authorization')).toBe('Bearer or-route-key')
})

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

test('OpenGateway MiMo replays real reasoning_content without adding empty fallback', async () => {
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-opengateway-mimo',
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
    messages: [
      { role: 'user', content: 'Use an agent' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect code with an agent.',
          },
          {
            type: 'tool_use',
            id: 'call_agent_1',
            name: 'Agent',
            input: {
              description: 'Inspect code',
              prompt: 'Look at the relevant code',
              subagent_type: 'general-purpose',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_agent_1',
            content: 'Agent finished',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect code with an agent.',
  )
  expect(requestBody).not.toHaveProperty('store')
})

test('Xiaomi MiMo replays real reasoning_content without adding empty fallback', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  process.env.MIMO_API_KEY = 'mimo-test-key'
  delete process.env.OPENAI_API_KEY
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-mimo',
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
    messages: [
      { role: 'user', content: 'Use an agent' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect code with an agent.',
          },
          {
            type: 'tool_use',
            id: 'call_agent_1',
            name: 'Agent',
            input: {
              description: 'Inspect code',
              prompt: 'Look at the relevant code',
              subagent_type: 'general-purpose',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_agent_1',
            content: 'Agent finished',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect code with an agent.',
  )
  expect(requestBody).not.toHaveProperty('store')
})

test('OpenGateway MiMo does not synthesize empty reasoning_content when missing', async () => {
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-opengateway-mimo',
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
    messages: [
      { role: 'user', content: 'Use an agent' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_agent_1',
            name: 'Agent',
            input: {
              description: 'Inspect code',
              prompt: 'Look at the relevant code',
              subagent_type: 'general-purpose',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_agent_1',
            content: 'Agent finished',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall).not.toHaveProperty('reasoning_content')
  expect(requestBody).not.toHaveProperty('store')
})

test('strips unsupported stream_options for Xiaomi MiMo streams', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  process.env.MIMO_API_KEY = 'mimo-test-key'
  delete process.env.OPENAI_API_KEY
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return makeSseResponse(
      makeStreamChunks([
        {
          id: 'chatcmpl-mimo',
          object: 'chat.completion.chunk',
          model: 'mimo-v2.5-pro',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'done' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-mimo',
          object: 'chat.completion.chunk',
          model: 'mimo-v2.5-pro',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        },
      ]),
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: true,
  })

  expect(requestBody).toMatchObject({
    stream: true,
    max_completion_tokens: 64,
  })
  expect(requestBody).not.toHaveProperty('stream_options')
  expect(requestBody).not.toHaveProperty('store')
})

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

test('uses GEMINI_ACCESS_TOKEN for Gemini OpenAI-compatible requests', async () => {
  let capturedAuthorization: string | null = null
  let capturedProject: string | null = null
  let requestUrl: string | undefined

  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_AUTH_MODE = 'access-token'
  process.env.GEMINI_ACCESS_TOKEN = 'gemini-access-token'
  process.env.GOOGLE_CLOUD_PROJECT = 'gemini-project'
  process.env.GEMINI_BASE_URL =
    'https://generativelanguage.googleapis.com/v1beta/openai'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash'
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY

  globalThis.fetch = (async (input, init) => {
    requestUrl = typeof input === 'string' ? input : input.url
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null
    capturedProject =
      headers?.['x-goog-user-project'] ??
      headers?.['X-Goog-User-Project'] ??
      null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-gemini',
        model: 'gemini-2.0-flash',
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
          prompt_tokens: 3,
          completion_tokens: 1,
          total_tokens: 4,
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
    model: 'gemini-2.0-flash',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(requestUrl).toBe(
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  )
  // Explicit type argument: TS narrows the closure-assigned variables to
  // their `null` initializer at this point (microsoft/TypeScript#9998).
  expect<string | null>(capturedAuthorization).toBe('Bearer gemini-access-token')
  expect<string | null>(capturedProject).toBe('gemini-project')
})

test('uses NVIDIA_API_KEY for NVIDIA NIM requests without OPENAI_API_KEY', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-nvidia',
        model: 'nvidia/llama-3.1-nemotron-70b-instruct',
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
          prompt_tokens: 3,
          completion_tokens: 1,
          total_tokens: 4,
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
    model: 'nvidia/llama-3.1-nemotron-70b-instruct',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect<string | null>(capturedAuthorization).toBe('Bearer nvidia-live-key')
})

test('does not use stale NVIDIA_API_KEY for non-NVIDIA OpenAI-compatible routes', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-openrouter',
        model: 'openai/gpt-5-mini',
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
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
})

test('does not use MINIMAX_API_KEY for non-MiniMax OpenAI-compatible routes', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-openrouter',
        model: 'openai/gpt-5-mini',
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
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
})

test('xiaomi mimo route uses api-key auth header and max_completion_tokens', async () => {
  let capturedHeaders: Record<string, string> | undefined
  let capturedBody: Record<string, unknown> | undefined

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  process.env.MIMO_API_KEY = 'mimo-live-key'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = init?.headers as Record<string, string>
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-mimo',
        model: 'mimo-v2.5-pro',
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
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedHeaders).toMatchObject({ 'api-key': 'mimo-live-key' })
  expect(capturedHeaders).not.toHaveProperty('Authorization')
  expect(capturedBody).toMatchObject({ max_completion_tokens: 32 })
  expect(capturedBody).not.toHaveProperty('max_tokens')
})
test('xiaomi mimo token plan uses raw api-key and OpenAI-compatible reasoning_effort', async () => {
  let capturedHeaders: Record<string, string> | undefined
  let capturedBody: Record<string, unknown> | undefined

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  process.env.MIMO_API_KEY = 'mimo-token-key'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = init?.headers as Record<string, string>
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return makeChatCompletionResponse('mimo-v2.5-pro')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'high',
  }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedHeaders).toMatchObject({ 'api-key': 'mimo-token-key' })
  expect(capturedHeaders).not.toHaveProperty('Authorization')
  expect(capturedBody).toMatchObject({
    max_completion_tokens: 32,
    reasoning_effort: 'high',
  })
  expect(capturedBody).not.toHaveProperty('max_tokens')
  expect(capturedBody).not.toHaveProperty('store')
  expect(capturedBody).not.toHaveProperty('stream_options')
})

test.each([
  'minimax-m3',
  'minimax-m2.7',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
])('opencode go %s direct env routing ignores stale custom auth and uses the Anthropic Messages request contract', async model => {
  let capturedUrl = ''
  let capturedHeaders: Headers | undefined
  let capturedBody: Record<string, unknown> | undefined

  process.env.OPENAI_BASE_URL = 'https://opencode.ai/zen/go/v1'
  delete process.env.OPENAI_API_KEY
  process.env.OPENAI_MODEL = model
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENCODE_API_KEY = 'fake-opencode-key'
  process.env.OPENAI_AUTH_HEADER = 'Authorization'
  process.env.OPENAI_AUTH_SCHEME = 'bearer'
  process.env.OPENAI_AUTH_HEADER_VALUE = 'stale-header-value'

  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input)
    capturedHeaders = new Headers(init?.headers)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: 'msg_opencode_go',
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
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
    model,
    system: 'test system',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedUrl).toBe('https://opencode.ai/zen/go/v1/messages')
  expect(capturedHeaders?.get('x-api-key')).toBe('fake-opencode-key')
  expect(capturedHeaders?.get('authorization')).toBeNull()
  expect(capturedBody).toEqual({
    model,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    ],
    max_tokens: 32,
    stream: false,
    system: 'test system',
  })
  expect(capturedBody).not.toHaveProperty('max_completion_tokens')
  expect(capturedBody).not.toHaveProperty('store')
})

test('opencode go messages endpoint rotates raw x-api-key credentials after rate-limit failure', async () => {
  const capturedUrls: string[] = []
  const capturedKeys: Array<string | null> = []

  process.env.OPENAI_BASE_URL = 'https://opencode.ai/zen/go/v1'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEYS
  process.env.OPENAI_MODEL = 'minimax-m3'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENCODE_API_KEY = 'fake-opencode-a,fake-opencode-b'

  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers)
    capturedUrls.push(String(input))
    capturedKeys.push(headers.get('x-api-key'))

    if (capturedKeys.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        id: 'msg_opencode_go_retry',
        type: 'message',
        role: 'assistant',
        model: 'minimax-m3',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
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
    model: 'minimax-m3',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedUrls).toEqual([
    'https://opencode.ai/zen/go/v1/messages',
    'https://opencode.ai/zen/go/v1/messages',
  ])
  expect(capturedKeys).toEqual(['fake-opencode-a', 'fake-opencode-b'])
})

test('gitlawb opengateway provider flag sends OPENGATEWAY_API_KEY as bearer auth despite stale generic base URL', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'
  delete process.env.OPENAI_API_KEY

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.url).toBe('https://opengateway.gitlawb.com/v1/chat/completions')
  expect(captured.authorization).toBe('Bearer fake-ogw-key')
})

test('gitlawb opengateway provider flag accepts OPENAI_API_KEY compatibility fallback', async () => {
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENGATEWAY_API_KEY
  process.env.OPENAI_API_KEY = 'fake-openai-fallback'

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.authorization).toBe('Bearer fake-openai-fallback')
})

test('gitlawb opengateway provider flag sends OPENAI_API_KEY fallback despite stale generic base URL', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'fake-openai-fallback'
  delete process.env.OPENGATEWAY_API_KEY

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.url).toBe('https://opengateway.gitlawb.com/v1/chat/completions')
  expect(captured.authorization).toBe('Bearer fake-openai-fallback')
})

test('gitlawb opengateway provider flag trims OPENGATEWAY_API_KEY before bearer auth', async () => {
  process.env.OPENGATEWAY_API_KEY = ' fake-ogw-key '
  delete process.env.OPENAI_API_KEY

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.authorization).toBe('Bearer fake-ogw-key')
})

test('gitlawb opengateway provider flag ignores blank OPENGATEWAY_API_KEY and uses OPENAI_API_KEY fallback', async () => {
  process.env.OPENGATEWAY_API_KEY = '   '
  process.env.OPENAI_API_KEY = 'fake-openai-fallback'

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.authorization).toBe('Bearer fake-openai-fallback')
})

test('gitlawb opengateway provider flag sends OPENGATEWAY_API_KEY to OPENGATEWAY_BASE_URL override', async () => {
  process.env.OPENGATEWAY_BASE_URL = 'http://localhost:8181/v1'
  process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'
  delete process.env.OPENAI_API_KEY

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.url).toBe('http://localhost:8181/v1/chat/completions')
  expect(captured.authorization).toBe('Bearer fake-ogw-key')
})

test('gitlawb opengateway provider flag sends OPENGATEWAY_API_KEY to custom OPENAI_BASE_URL fallback', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:8181/v1'
  process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'
  delete process.env.OPENGATEWAY_BASE_URL
  delete process.env.OPENAI_API_KEY

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.url).toBe('http://localhost:8181/v1/chat/completions')
  expect(captured.authorization).toBe('Bearer fake-ogw-key')
})

test('gitlawb opengateway provider flag prefers OPENGATEWAY_API_KEY over generic OPENAI_API_KEY for custom base URL', async () => {
  process.env.OPENGATEWAY_BASE_URL = 'http://localhost:8181/v1'
  process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'
  process.env.OPENAI_API_KEY = 'fake-generic-openai-key'

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.url).toBe('http://localhost:8181/v1/chat/completions')
  expect(captured.authorization).toBe('Bearer fake-ogw-key')
})

test('gitlawb opengateway provider flag prefers OPENGATEWAY_API_KEY over generic OPENAI_API_KEYS pool', async () => {
  process.env.OPENGATEWAY_BASE_URL = 'http://localhost:8181/v1'
  process.env.OPENGATEWAY_API_KEY = 'fake-ogw-key'
  process.env.OPENAI_API_KEYS = 'fake-openai-pool-a,fake-openai-pool-b'
  delete process.env.OPENAI_API_KEY

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.url).toBe('http://localhost:8181/v1/chat/completions')
  expect(captured.authorization).toBe('Bearer fake-ogw-key')
})

test('gitlawb opengateway provider flag uses generic OPENAI_API_KEYS pool before generic OPENAI_API_KEY fallback', async () => {
  process.env.OPENGATEWAY_BASE_URL = 'http://localhost:8181/v1'
  process.env.OPENAI_API_KEYS = 'fake-openai-pool-a,fake-openai-pool-b'
  process.env.OPENAI_API_KEY = 'fake-generic-openai-key'
  delete process.env.OPENGATEWAY_API_KEY

  const result = applyProviderFlag('gitlawb-opengateway', [])
  expect(result.error).toBeUndefined()

  const captured = await captureChatCompletionRequest()

  expect(captured.url).toBe('http://localhost:8181/v1/chat/completions')
  expect(captured.authorization).toBe('Bearer fake-openai-pool-a')
})

test('gitlawb opengateway stored provider profile key becomes bearer auth', async () => {
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENGATEWAY_API_KEY

  applyProviderProfileToProcessEnv({
    id: 'stored-opengateway',
    provider: 'gitlawb-opengateway',
    name: 'Gitlawb Opengateway',
    baseUrl: 'https://opengateway.gitlawb.com/v1',
    model: 'mimo-v2.5-pro',
    apiKey: 'fake-profile-key',
  })

  const captured = await captureChatCompletionRequest()

  expect(captured.authorization).toBe('Bearer fake-profile-key')
})

test('openai route still sends OPENAI_API_KEY as bearer auth', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEY = 'fake-openai-key'
  delete process.env.OPENGATEWAY_API_KEY

  const captured = await captureChatCompletionRequest('gpt-5.5')

  expect(captured.authorization).toBe('Bearer fake-openai-key')
})

test('OPENAI_API_KEYS rejects placeholder values before sending requests', async () => {
  const authorizations: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEYS = 'key-a,SUA_CHAVE'
  process.env.OPENAI_API_KEY = 'single-key-should-not-hide-invalid-pool'

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)
    return makeChatCompletionResponse('gpt-5.5')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow(/SUA_CHAVE|Authentication failed/)

  expect(authorizations).toEqual([])
})
test('OPENAI_API_KEYS rotates to the next key on rate-limit failure', async () => {
  const authorizations: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEYS = 'key-a,key-b'
  process.env.OPENAI_API_KEY = 'single-key-should-not-win'

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)

    if (authorizations.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return makeChatCompletionResponse('gpt-5.5')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(authorizations).toEqual(['Bearer key-a', 'Bearer key-b'])
})

test('comma-separated OPENAI_API_KEY rotates to the next key on rate-limit failure', async () => {
  const authorizations: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEY = 'key-a,key-b'
  delete process.env.OPENAI_API_KEYS

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)

    if (authorizations.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return makeChatCompletionResponse('gpt-5.5')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(authorizations).toEqual(['Bearer key-a', 'Bearer key-b'])
})

test('OPENAI_API_KEYS does not rotate through pool on provider 5xx outage', async () => {
  const authorizations: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEYS = 'key-a,key-b'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)

    return new Response(JSON.stringify({ error: { message: 'server error' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow()

  expect(authorizations).toEqual(['Bearer key-a'])
})
test('OPENAI_API_KEYS preserves cooldown state across client requests', async () => {
  const authorizations: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEYS = 'key-a,key-b'

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)

    if (authorizations.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return makeChatCompletionResponse('gpt-5.5')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  for (let i = 0; i < 2; i++) {
    await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    })
  }

  expect(authorizations).toEqual([
    'Bearer key-a',
    'Bearer key-b',
    'Bearer key-b',
  ])
})

test('OPENAI_API_KEYS rotates Azure api-key auth on auth failure', async () => {
  const apiKeys: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://example.openai.azure.com/openai/deployments/test/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEYS = 'azure-key-a,azure-key-b'

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    apiKeys.push(headers?.['api-key'] ?? null)

    if (apiKeys.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return makeChatCompletionResponse('gpt-5.5')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(apiKeys).toEqual(['azure-key-a', 'azure-key-b'])
})

test('OPENAI_API_KEYS does not reuse auth-disabled credentials across client requests', async () => {
  const authorizations: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEYS = 'key-a,key-b'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)

    return new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow()

  await expect(
    client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello again' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow()

  expect(authorizations).toEqual(['Bearer key-a', 'Bearer key-b'])
})

test('OPENAI_API_KEYS permanently evicts 403 auth failures', async () => {
  const authorizations: Array<string | null> = []

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEYS = 'key-a,key-b'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)

    return new Response(JSON.stringify({ error: { message: 'forbidden' } }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow()

  await expect(
    client.beta.messages.create({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello again' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow()

  expect(authorizations).toEqual(['Bearer key-a', 'Bearer key-b'])
})
test('does not use BNKR_API_KEY for non-Bankr OpenAI-compatible routes', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.BNKR_API_KEY = 'bankr-live-key'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-openrouter',
        model: 'openai/gpt-5-mini',
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
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
})

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

test('normalizes plain string Bash tool arguments from OpenAI-compatible responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: 'pwd',
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
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
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
      id: 'function-call-1',
      name: 'Bash',
      input: { command: 'pwd' },
    },
  ])
})

test('normalizes Bash tool arguments that are valid JSON strings', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '"pwd"',
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
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: { command: 'pwd' },
    },
  ])
})

test.each([
  ['false', false],
  ['null', null],
  ['[]', []],
])(
  'preserves malformed Bash JSON literals as parsed values in non-streaming responses: %s',
  async (argumentsValue, expectedInput) => {
    globalThis.fetch = (async (_input, _init) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          model: 'google/gemini-3.1-pro-preview',
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'function-call-1',
                    type: 'function',
                    function: {
                      name: 'Bash',
                      arguments: argumentsValue,
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
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: false,
    }) as {
      content?: Array<Record<string, unknown>>
    }

    expect(message.content).toEqual([
      {
        type: 'tool_use',
        id: 'function-call-1',
        name: 'Bash',
        input: expectedInput,
      },
    ])
  },
)

test('keeps terminal empty Bash tool arguments invalid in non-streaming responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '',
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
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: {},
    },
  ])
})

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

test('preserves raw input for unknown plain string tool arguments', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'UnknownTool',
                    arguments: 'pwd',
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
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use tool' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'UnknownTool',
      input: {},
    },
  ])
})

test('preserves parsed string input for unknown JSON string tool arguments', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'UnknownTool',
                    arguments: '"pwd"',
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
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use tool' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'UnknownTool',
      input: 'pwd',
    },
  ])
})

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

// ---------------------------------------------------------------------------
// Issue #202 — consecutive role coalescing (Devstral, Mistral strict templates)
// ---------------------------------------------------------------------------

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

test('non-streaming: preserves response body when usage parsing fails', async () => {
  const json = JSON as unknown as { parse: typeof JSON.parse }
  const originalJSONParse = json.parse
  const responseBody = JSON.stringify({
    id: 'chatcmpl-1',
    model: 'glm-5',
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
      completion_tokens: 20,
      total_tokens: 30,
    },
  })
  let usageParseFailed = false

  // Throw only for the usage-extraction parse of the response body.
  // A global "throw once" mock is unreliable here: Bun's native
  // Response.json() does not go through JS-level JSON.parse, so the
  // second parse the original test relied on never happens (parseCalls
  // stays at 1 and `toBeGreaterThan(1)` fails). Scoping the failure to
  // the response body targets the _doRequest parse without breaking
  // unrelated JSON.parse calls in the request pipeline, and works in
  // both Bun (native Response.json) and Node (undici, which does call
  // JSON.parse — guarded by `usageParseFailed` so it won't throw again).
  json.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    if (!usageParseFailed && text === responseBody) {
      usageParseFailed = true
      throw new Error('simulated usage parse failure')
    }
    return originalJSONParse(text, reviver)
  }) as typeof JSON.parse

  try {
    globalThis.fetch = (async () => {
      return new Response(responseBody, {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient

    const result = (await client.beta.messages.create({
      model: 'glm-5',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    })) as { content: Array<Record<string, unknown>> }

    // Usage extraction threw, but the recreated Response still holds the
    // body so downstream response.json() can read it.
    expect(usageParseFailed).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
  } finally {
    json.parse = originalJSONParse
  }
})

test('non-streaming: preserves response.url routing metadata after body read', async () => {
  // _doRequest reads the body for usage extraction and recreates the
  // Response with new Response(bodyText, ...). That drops response.url to
  // "", which breaks create()'s /responses, /messages, and Gemini routing.
  // This test pins an Anthropic-shaped body behind a /messages URL: if url
  // is preserved, create() passes the body through unchanged; if url is
  // lost, it falls through to _convertNonStreamingResponse and the
  // Anthropic-only fields (stop_reason, input_tokens) surface as wrong
  // output or missing content.
  const anthropicBody = JSON.stringify({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'passthrough ok' }],
    model: 'claude-3',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
  })

  globalThis.fetch = (async () => {
    const r = new Response(anthropicBody, {
      headers: { 'Content-Type': 'application/json' },
    })
    // fetch() sets .url from the request; new Response() cannot. Simulate
    // the fetch-attached URL so create()'s routing can see /messages.
    Object.defineProperty(r, 'url', {
      value: 'https://api.anthropic-shaped.example.com/v1/messages',
      configurable: true,
    })
    return r
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = (await client.beta.messages.create({
    model: 'glm-5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  // /messages passthrough returns the Anthropic body verbatim. If url were
  // lost, _convertNonStreamingResponse would try to read OpenAI choices[]
  // and content would not match.
  expect(result.content).toEqual([{ type: 'text', text: 'passthrough ok' }])
})

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

test('strips credentials and query params from URL in fetch network error message', async () => {
  process.env.OPENAI_BASE_URL =
    'https://user:password@internal.example.test/v1?token=abc123'
  process.env.OPENAI_API_KEY = 'test-key'

  globalThis.fetch = asMockFetch(mock(async () => {
    throw new TypeError(
      'fetch failed https://user:password@internal.example.test/v1?token=abc123/chat/completions',
    )
  }))

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  let caught: unknown
  try {
    await client.beta.messages.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    })
  } catch (error) {
    caught = error
  }

  const message = (caught as Error).message
  expect(message).toContain('internal.example.test')
  expect(message).toContain('fetch failed')
  expect(message).not.toContain('password')
  expect(message).not.toContain('user:')
  expect(message).not.toContain('token=abc123')
})

test('classifies localhost transport failures with actionable category marker', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const transportError = Object.assign(new TypeError('fetch failed'), {
    code: 'ECONNREFUSED',
  })

  globalThis.fetch = asMockFetch(mock(async () => {
    throw transportError
  }))

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow('openai_category=connection_refused')

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow('local server is running')
})

test('transport failures are not labeled with HTTP status 503', async () => {
  // Issue #971: ENETDOWN (and other transport errors) are emitted before any
  // HTTP response is received. Reporting them as "503" makes users believe the
  // upstream server returned 503 Service Unavailable.
  process.env.OPENAI_BASE_URL = 'https://intranet.example.test/v1'

  const transportError = Object.assign(new TypeError('fetch failed'), {
    code: 'ENETDOWN',
  })

  globalThis.fetch = asMockFetch(mock(async () => {
    throw transportError
  }))

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  let caught: unknown
  try {
    await client.beta.messages.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    })
  } catch (error) {
    caught = error
  }

  expect(caught).toBeDefined()
  const err = caught as { status?: number; message: string; constructor: { name: string } }
  expect(err.constructor.name).toBe('APIConnectionError')
  expect(err.status).toBeUndefined()
  expect(err.message).not.toMatch(/^503\b/)
  expect(err.message).toContain('OpenAI API transport error')
  expect(err.message).toContain('code=ENETDOWN')
  expect(err.message).toContain('openai_category=network_error')
})

test('propagates AbortError without wrapping it as transport failure', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const abortError = new DOMException('The operation was aborted.', 'AbortError')
  globalThis.fetch = asMockFetch(mock(async () => {
    throw abortError
  }))

  const controller = new AbortController()
  controller.abort()

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create(
      {
        model: 'qwen2.5-coder:7b',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        stream: false,
      },
      { signal: controller.signal },
    ),
  ).rejects.toBe(abortError)
})

test('classifies chat-completions endpoint 404 failures with endpoint_not_found marker', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434'

  globalThis.fetch = asMockFetch(mock(async () =>
    new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
      },
    })))

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow('openai_category=endpoint_not_found')
})
test('self-heals localhost resolution failures by retrying local loopback base URL', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const requestUrls: string[] = []
  globalThis.fetch = (async (input, _init) => {
    const url = typeof input === 'string' ? input : input.url
    requestUrls.push(url)

    if (url.includes('localhost')) {
      const error = Object.assign(new TypeError('fetch failed'), {
        code: 'ENOTFOUND',
      })
      throw error
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'qwen2.5-coder:7b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello from loopback',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
        },
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

  expect(requestUrls[0]).toBe('http://localhost:11434/api/chat')
  expect(requestUrls).toContain('http://127.0.0.1:11434/api/chat')
})

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

test('keeps remote Ollama-named gateways on chat completions', async () => {
  process.env.OPENAI_BASE_URL = 'https://ollama-gateway.example.com/v1'

  const requestUrls: string[] = []
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    requestUrls.push(url)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.max_tokens).toBe(64)
    expect(body.options).toBeUndefined()

    return makeChatCompletionResponse('llama3.1:8b')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).resolves.toBeDefined()

  expect(requestUrls).toEqual([
    'https://ollama-gateway.example.com/v1/chat/completions',
  ])
})

test('keeps HTTPS localhost Ollama-port proxies on chat completions', async () => {
  process.env.OPENAI_BASE_URL = 'https://localhost:11434/v1'

  const requestUrls: string[] = []
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    requestUrls.push(url)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.max_tokens).toBe(64)
    expect(body.options).toBeUndefined()

    return makeChatCompletionResponse('llama3.1:8b')
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).resolves.toBeDefined()

  expect(requestUrls).toEqual([
    'https://localhost:11434/v1/chat/completions',
  ])
})

test('self-heals tool-call incompatibility by retrying local Ollama requests without tools', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    requestBodies.push(requestBody)

    if (requestBodies.length === 1) {
      return new Response('tool_calls are not supported', {
        status: 400,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'qwen2.5-coder:7b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'fallback without tools',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12,
        },
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
      tools: [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
            },
            required: ['filePath'],
          },
        },
      ],
      max_tokens: 64,
      stream: false,
    }),
  ).resolves.toBeDefined()

  expect(requestBodies).toHaveLength(2)
  expect(Array.isArray(requestBodies[0]?.tools)).toBe(true)
  expect(requestBodies[0]?.tool_choice).toBeUndefined()
  expect(
    requestBodies[1]?.tools === undefined ||
      (Array.isArray(requestBodies[1]?.tools) && requestBodies[1]?.tools.length === 0),
  ).toBe(true)
  expect(requestBodies[1]?.tool_choice).toBeUndefined()
  expect(requestBodies[1]?.tool_stream).toBeUndefined()
})

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

test('Moonshot: uses max_tokens (not max_completion_tokens) and strips store', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
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
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Cerebras: strips unsupported store on chat_completions (#1023)', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.cerebras.ai/v1'
  process.env.OPENAI_API_KEY = 'csk-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'llama3.1-8b',
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
    model: 'llama3.1-8b',
    system: 'you are cerebras',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.store).toBeUndefined()
})

test('Local provider (vLLM/Ollama/etc.): strips unsupported store on chat_completions (#672)', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:8000/v1'
  process.env.OPENAI_API_KEY = 'sk-local'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'qwen-3.5-27b',
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
    model: 'qwen-3.5-27b',
    system: 'you are local',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.store).toBeUndefined()
})

test('Mistral: strips unsupported store on chat_completions (#739)', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.mistral.ai/v1'
  process.env.OPENAI_API_KEY = 'mistral-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'codestral-2508',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'codestral-2508',
    system: 'you are mistral',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.store).toBeUndefined()
})

test('Mistral host fallback: strips store on an unresolved Mistral-host route (#739)', async () => {
  // `api.mistral.ai/v1` resolves to the Mistral descriptor route, whose
  // removeBodyFields already strips `store` — so the test above passes even
  // without the hasMistralApiHost fallback. This case pins the fallback's real
  // value: a Mistral-host proxy (`proxy.mistral.ai`) that does NOT resolve to a
  // descriptor route (resolveRouteIdFromBaseUrl returns null, no
  // removeBodyFields), so `store` is stripped *only* by hasMistralApiHost.
  process.env.OPENAI_BASE_URL = 'https://proxy.mistral.ai/v1'
  process.env.OPENAI_API_KEY = 'mistral-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'codestral-2508',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'codestral-2508',
    system: 'you are mistral',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  // The shim sets `store: false` on every chat_completions body; without the
  // fallback this unresolved route would forward it and hit Mistral's 422.
  expect(requestBody?.store).toBeUndefined()
  // #739's Mistral 422 rejects `max_completion_tokens` as well — the host
  // fallback must also map it to `max_tokens` on the unresolved route, since
  // the generic config leaves the `max_completion_tokens` default.
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.max_tokens).toBe(64)
})

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

test('Groq: keeps max_completion_tokens and strips unsupported store', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1'
  process.env.OPENAI_API_KEY = 'gsk-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'llama-3.3-70b-versatile',
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
    model: 'llama-3.3-70b-versatile',
    system: 'you are groq',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_completion_tokens).toBe(256)
  expect(requestBody?.max_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})


test('Groq: strips reasoning_effort even when compat inference matches the model', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1'
  process.env.OPENAI_API_KEY = 'gsk-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-r1-distill-llama-70b',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'xhigh' }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-r1-distill-llama-70b',
    system: 'you are groq',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
    thinking: { type: 'enabled' },
  })

  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})
test('Moonshot: echoes reasoning_content on assistant tool-call messages', async () => {
  // Regression for: "API Error: 400 {"error":{"message":"thinking is enabled
  // but reasoning_content is missing in assistant tool call message at index
  // N"}}" when the agent sends a prior-turn assistant response back to Kimi.
  // The thinking block captured from the inbound response must round-trip
  // as reasoning_content on the outgoing echoed assistant message.
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
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
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [
      { role: 'user', content: 'check the logs' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect logs via Bash; running a cat.',
          },
          { type: 'text', text: "I'll inspect the logs." },
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'cat /tmp/app.log' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_bash_1',
            content: 'log line 1\nlog line 2',
          },
        ],
      },
    ],
    max_tokens: 256,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect logs via Bash; running a cat.',
  )
})

test('DeepSeek echoes reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
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
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
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
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
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
  expect(assistantWithToolCall?.reasoning_content).toBe('thought')
})

test('generic OpenAI-compatible providers do not echo reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'sk-openai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
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
    model: 'gpt-4o',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
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
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
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
  expect(assistantWithToolCall?.reasoning_content).toBeUndefined()
})

test('gateway-routed DeepSeek models inherit descriptor-backed reasoning and token shaping', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'sk-openrouter-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek/deepseek-reasoner',
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
    model: 'deepseek/deepseek-reasoner',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
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
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
    thinking: { type: 'enabled' },
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    message => message.role === 'assistant' && Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall?.reasoning_content).toBe('thought')
  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
  expect(requestBody?.max_tokens).toBe(64)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Moonshot: cn host is also detected', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.cn/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
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
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.store).toBeUndefined()
})

test('Kimi Code endpoint inherits Moonshot max_tokens/store compatibility', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1'
  process.env.OPENAI_API_KEY = 'sk-kimi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-for-coding',
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
    model: 'kimi-for-coding',
    system: 'you are kimi code',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Kimi Code endpoint echoes reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1'
  process.env.OPENAI_API_KEY = 'sk-kimi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-for-coding',
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
    model: 'kimi-for-coding',
    system: 'you are kimi code',
    messages: [
      { role: 'user', content: 'check the logs' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect logs via Bash; running a cat.',
          },
          { type: 'text', text: "I'll inspect the logs." },
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'cat /tmp/app.log' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_bash_1',
            content: 'log line 1\nlog line 2',
          },
        ],
      },
    ],
    max_tokens: 256,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect logs via Bash; running a cat.',
  )
})

test('DeepSeek sends thinking toggle and normalized reasoning effort', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-pro',
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
    model: 'deepseek-v4-pro',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
    thinking: { type: 'enabled' },
  })

  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
  expect(requestBody?.max_tokens).toBe(64)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

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

test('DeepSeek omits thinking controls when the Anthropic-side request does not set them', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
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
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: false,
  })

  expect(requestBody?.thinking).toBeUndefined()
  expect(requestBody?.reasoning_effort).toBeUndefined()
})

test('DeepSeek forwards an explicit thinking disable toggle for V4 models', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
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
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: false,
    thinking: { type: 'disabled' },
  })

  expect(requestBody?.thinking).toEqual({ type: 'disabled' })
  expect(requestBody?.reasoning_effort).toBeUndefined()
})


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

test('Z.AI: uses max_tokens (not max_completion_tokens) and strips store', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'GLM-5.1',
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
    model: 'GLM-5.1',
    system: 'you are glm',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Z.AI: thinking mode enabled when requested', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'GLM-5.1',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'Let me think...',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'GLM-5.1',
    system: 'you are glm',
    messages: [{ role: 'user', content: 'think hard' }],
    max_tokens: 1024,
    stream: false,
    thinking: { type: 'enabled', budget_tokens: 1024 },
  })

  expect((requestBody?.thinking as Record<string, string>)?.type).toBe('enabled')
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.max_tokens).toBe(1024)
})

test('Z.AI GLM-5.2: default request relies on provider thinking defaults', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5.2',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'glm-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.model).toBe('glm-5.2')
  expect(requestBody?.thinking).toBeUndefined()
  expect(requestBody?.reasoning_effort).toBeUndefined()
})

test('Z.AI GLM-5.2: user-selected xhigh effort maps to provider max effort', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5.2',
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
    model: 'glm-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.model).toBe('glm-5.2')
  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
})

test.each([
  ['glm-5.2?reasoning=low', 'high'],
  ['glm-5.2?reasoning=medium', 'high'],
  ['glm-5.2?reasoning=high', 'high'],
  ['glm-5.2?reasoning=xhigh', 'max'],
  ['openrouter/zhipu/glm-5.2?reasoning=low', 'high'],
  ['openrouter/zhipu/glm-5.2?reasoning=medium', 'high'],
  ['openrouter/zhipu/glm-5.2?reasoning=high', 'high'],
  ['openrouter/zhipu/glm-5.2?reasoning=xhigh', 'max'],
] as const)('Z.AI GLM-5.2: %s enables mapped reasoning effort', async (model, effort) => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  const expectedModel = model.split('?')[0];
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: expectedModel,
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.model).toBe(expectedModel)
  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe(effort)
})

test.each([
  'GLM-5.1?reasoning=high',
  'GLM-4.5-Air?reasoning=high',
] as const)('Z.AI GLM: %s does not receive GLM-5.2-only reasoning_effort', async model => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model,
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.model).toBe(model.split('?', 1)[0])
  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBeUndefined()
})

test('Z.AI GLM-5.2: model-query thinking disable omits reasoning effort', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5.2',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'glm-5.2?thinking=disabled&reasoning=xhigh',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })

  expect(requestBody?.model).toBe('glm-5.2')
  expect(requestBody?.thinking).toEqual({ type: 'disabled' })
  expect(requestBody?.reasoning_effort).toBeUndefined()
})

test('Z.AI GLM-5.2: per-turn thinking overrides model-query default', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5.2',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'glm-5.2?thinking=disabled&reasoning=high',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
    thinking: { type: 'enabled' },
  })

  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('high')
})

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

test('Z.AI GLM-5.2: streaming requests with tools send tool_stream', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5.2',
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5.2',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]))
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'glm-5.2',
    messages: [{ role: 'user', content: 'run pwd' }],
    tools: [
      {
        name: 'Bash',
        description: 'Run a shell command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ],
    max_tokens: 64,
    stream: true,
  })

  expect(requestBody?.tool_stream).toBe(true)
})

test('Hicap GLM-5.2: uses Z.AI-compatible request shaping', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.hicap.ai/v1'
  process.env.HICAP_API_KEY = 'sk-hicap-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5.2',
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5.2',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]))
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ reasoningEffort: 'xhigh' }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'GLM-5.2',
    messages: [{ role: 'user', content: 'run pwd' }],
    tools: [
      {
        name: 'Bash',
        description: 'Run a shell command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ],
    max_tokens: 64,
    stream: true,
  })

  expect(requestBody?.model).toBe('glm-5.2')
  expect(requestBody?.store).toBeUndefined()
  expect(requestBody?.max_tokens).toBe(64)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
  expect(requestBody?.tool_stream).toBe(true)
})
test('Z.AI GLM-5.2: remote tool incompatibility does not use local toolless retry', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response('tool_calls are not supported', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'glm-5.2',
      messages: [{ role: 'user', content: 'run pwd' }],
      tools: [
        {
          name: 'Bash',
          description: 'Run a shell command',
          input_schema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      ],
      max_tokens: 64,
      stream: true,
    }),
  ).rejects.toThrow()

  expect(requestBodies).toHaveLength(1)
  expect(requestBodies[0]?.tool_stream).toBe(true)
})

test.each([
  ['non-streaming Z.AI request with tools', 'https://api.z.ai/api/coding/paas/v4', false, true, 'glm-5.2'],
  ['streaming Z.AI request without tools', 'https://api.z.ai/api/coding/paas/v4', true, false, 'glm-5.2'],
  ['streaming non-Z.AI request with tools', 'https://api.openai.com/v1', true, true, 'gpt-4o'],
] as const)('does not send tool_stream for %s', async (_name, baseUrl, stream, includeTools, model) => {
  process.env.OPENAI_BASE_URL = baseUrl
  process.env.OPENAI_API_KEY = 'sk-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    if (stream) {
      return makeSseResponse(makeStreamChunks([
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          model,
          choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
      ]))
    }
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model,
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    tools: includeTools
      ? [
          {
            name: 'Bash',
            description: 'Run a shell command',
            input_schema: {
              type: 'object',
              properties: { command: { type: 'string' } },
              required: ['command'],
            },
          },
        ]
      : undefined,
    max_tokens: 64,
    stream,
  })

  expect(requestBody?.tool_stream).toBeUndefined()
})

test('Z.AI GLM-5.2: preserved thinking round-trips with tool calls', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5.2',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'glm-5.2',
    messages: [
      { role: 'user', content: 'inspect files' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need to list files before answering.' },
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_bash_1', content: 'README.md' },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    message => message.role === 'assistant' && Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to list files before answering.',
  )
  expect(assistantWithToolCall?.tool_calls).toEqual([
    {
      id: 'call_bash_1',
      type: 'function',
      function: {
        name: 'Bash',
        arguments: JSON.stringify({ command: 'ls' }),
      },
    },
  ])
})

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

test('emits reasoning_effort on chat_completions when reasoningEffort is passed', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'

  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.4',
        choices: [
          {
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 16,
    stream: false,
  })

  expect(requestBody?.reasoning_effort).toBe('xhigh')
})

test('omits reasoning_effort on chat_completions when no override and model has no alias default', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'

  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
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
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 16,
    stream: false,
  })

  expect(requestBody && 'reasoning_effort' in requestBody).toBe(false)
})

test('emits reasoning_effort from codex alias default when no override is passed', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'

  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.4',
        choices: [
          {
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 16,
    stream: false,
  })

  expect(requestBody?.reasoning_effort).toBe('high')
})

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

function makeCodexSseResponse(responseData: Record<string, unknown>): Response {
  const data = JSON.stringify(responseData)
  return makeSseResponse([`event: response.completed\ndata: ${data}\n\n`])
}

test('GitHub Copilot 401 chat_completions retries with refreshed token', async () => {
  const realModule = realGithubModelsCredentials
  try {
    const refreshSpy = mock(async () => {
      process.env.GITHUB_TOKEN = 'refreshed-token'
      process.env.OPENAI_API_KEY = 'refreshed-token'
      return true
    })

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    process.env.OPENAI_API_KEY = 'initial-token'
    process.env.GITHUB_TOKEN = 'initial-token'

    let fetchCallCount = 0
    let firstAuth: string | undefined
    let secondAuth: string | undefined

    globalThis.fetch = ((_input, init) => {
      fetchCallCount++
      const headers = init?.headers as Record<string, string> | undefined
      const auth = headers?.Authorization

      if (fetchCallCount === 1) {
        firstAuth = auth
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: 'token expired' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      if (fetchCallCount === 2) {
        secondAuth = auth
        return Promise.resolve(makeChatCompletionResponse('gpt-4'))
      }

      throw new Error(`unexpected fetch call #${fetchCallCount}`)
    }) as unknown as typeof globalThis.fetch

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-retry')

    const client = createClient({}) as OpenAIShimClient

    const response = await client.beta.messages.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    })

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(process.env.GITHUB_TOKEN).toBe('refreshed-token')
    expect(process.env.OPENAI_API_KEY).toBe('refreshed-token')
    expect(fetchCallCount).toBe(2)
    expect(firstAuth).toBe('Bearer initial-token')
    expect(secondAuth).toBe('Bearer refreshed-token')
    expect(response).toBeDefined()
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realModule)
  }
})

test('GitHub Copilot 401 codex_responses retries with refreshed token', async () => {
  const realGithubModule = realGithubModelsCredentials
  const realCodexModule = realCodexShim
  try {
    const refreshSpy = mock(async () => {
      process.env.GITHUB_TOKEN = 'refreshed-token'
      process.env.OPENAI_API_KEY = 'refreshed-token'
      return true
    })

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realGithubModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    let codexCallCount = 0
    let firstAuth: string | undefined
    let secondAuth: string | undefined

    mock.module('./codexShim.js', () => ({
      ...realCodexModule,
      performCodexRequest: mock(async (opts: { credentials: { apiKey: string } }) => {
        codexCallCount++
        const apiKey = opts.credentials?.apiKey

        if (codexCallCount === 1) {
          firstAuth = apiKey
          throw APIError.generate(401, undefined, 'token expired', new Headers())
        }

        if (codexCallCount === 2) {
          secondAuth = apiKey
          return makeCodexSseResponse({
            response: {
              id: 'resp_test',
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
              model: 'gpt-5',
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          })
        }

        throw new Error(`unexpected codex call #${codexCallCount}`)
      }),
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    process.env.OPENAI_API_KEY = 'initial-token'
    process.env.GITHUB_TOKEN = 'initial-token'

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-retry-codex')

    const client = createClient({}) as OpenAIShimClient

    const response = await client.beta.messages.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    })

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(process.env.GITHUB_TOKEN).toBe('refreshed-token')
    expect(process.env.OPENAI_API_KEY).toBe('refreshed-token')
    expect(codexCallCount).toBe(2)
    expect(firstAuth).toBe('initial-token')
    expect(secondAuth).toBe('refreshed-token')
    expect(response).toBeDefined()
    expect((response as Record<string, unknown>).content).toBeDefined()
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realGithubModule)
    mock.module('./codexShim.js', () => realCodexModule)
  }
})

test('GitHub Copilot 401 with credential pool uses refreshed token not pool key', async () => {
  const realGithubModule = realGithubModelsCredentials
  try {
    const refreshSpy = mock(async () => {
      process.env.GITHUB_TOKEN = 'refreshed-token'
      process.env.OPENAI_API_KEY = 'refreshed-token'
      return true
    })

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realGithubModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    delete process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEYS = 'initial-token,second-key'
    process.env.GITHUB_TOKEN = 'initial-token'

    let fetchCallCount = 0
    let usedAuthHeaders: string[] = []

    globalThis.fetch = ((_input, init) => {
      fetchCallCount++
      const headers = init?.headers as Record<string, string> | undefined
      usedAuthHeaders.push(headers?.Authorization ?? '')

      if (fetchCallCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: 'token expired' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      return Promise.resolve(makeChatCompletionResponse('gpt-4'))
    }) as unknown as typeof globalThis.fetch

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-pool')

    const client = createClient({}) as OpenAIShimClient

    const response = await client.beta.messages.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    })

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(fetchCallCount).toBe(2)
    expect(usedAuthHeaders[0]).toBe('Bearer initial-token')
    expect(usedAuthHeaders[1]).toBe('Bearer refreshed-token')
    expect(response).toBeDefined()
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realGithubModule)
  }
})

test('GitHub Copilot 401 with "token has expired" triggers refresh', async () => {
  const realGithubModule = realGithubModelsCredentials
  try {
    const refreshSpy = mock(async () => {
      process.env.GITHUB_TOKEN = 'refreshed-token'
      process.env.OPENAI_API_KEY = 'refreshed-token'
      return true
    })

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realGithubModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    process.env.OPENAI_API_KEY = 'initial-token'
    process.env.GITHUB_TOKEN = 'initial-token'

    let fetchCallCount = 0

    globalThis.fetch = ((_input, init) => {
      fetchCallCount++

      if (fetchCallCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: 'token has expired' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      return Promise.resolve(makeChatCompletionResponse('gpt-4'))
    }) as unknown as typeof globalThis.fetch

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-has-expired')

    const client = createClient({}) as OpenAIShimClient

    const response = await client.beta.messages.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
      stream: false,
    })

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(fetchCallCount).toBe(2)
    expect(response).toBeDefined()
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realGithubModule)
  }
})

test('GitHub Copilot 401 without expired-token message does not trigger refresh', async () => {
  const realGithubModule = realGithubModelsCredentials
  try {
    const refreshSpy = mock(async () => true)

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realGithubModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    process.env.OPENAI_API_KEY = 'initial-token'
    process.env.GITHUB_TOKEN = 'initial-token'

    let fetchCallCount = 0

    globalThis.fetch = ((_input) => {
      fetchCallCount++
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: 'invalid token' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-no-refresh')

    const client = createClient({}) as OpenAIShimClient

    await expect(
      client.beta.messages.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 32,
        stream: false,
      }),
    ).rejects.toThrow()

    expect(refreshSpy).toHaveBeenCalledTimes(0)
    expect(fetchCallCount).toBe(1)
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realGithubModule)
  }
})

test('GitHub Copilot 401 refresh returning same token does not update auth', async () => {
  const realGithubModule = realGithubModelsCredentials
  try {
    const refreshSpy = mock(async () => {
      process.env.GITHUB_TOKEN = 'initial-token'
      process.env.OPENAI_API_KEY = 'initial-token'
      return true
    })

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realGithubModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    process.env.OPENAI_API_KEY = 'initial-token'
    process.env.GITHUB_TOKEN = 'initial-token'

    let fetchCallCount = 0
    let usedAuthHeaders: string[] = []

    globalThis.fetch = ((_input, init) => {
      fetchCallCount++
      const headers = init?.headers as Record<string, string> | undefined
      usedAuthHeaders.push(headers?.Authorization ?? '')

      return Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: 'token expired' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-same-token')

    const client = createClient({}) as OpenAIShimClient

    await expect(
      client.beta.messages.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 32,
        stream: false,
      }),
    ).rejects.toThrow()

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(fetchCallCount).toBeGreaterThanOrEqual(2)
    expect(usedAuthHeaders.every(h => h === 'Bearer initial-token')).toBe(true)
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realGithubModule)
  }
})

test('GitHub Copilot 401 codex_responses with providerOverride does not trigger refresh', async () => {
  const realGithubModule = realGithubModelsCredentials
  try {
    const refreshSpy = mock(async () => {
      process.env.GITHUB_TOKEN = 'refreshed-token'
      process.env.OPENAI_API_KEY = 'refreshed-token'
      return true
    })

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realGithubModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    process.env.OPENAI_API_KEY = 'stored-copilot-token'
    process.env.GITHUB_TOKEN = 'stored-copilot-token'

    // Mock fetch so performCodexRequest gets a 401 response (no codexShim mock needed)
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: 'token expired' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      )) as unknown as typeof globalThis.fetch

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-override-codex')

    // providerOverride.apiKey differs from OPENAI_API_KEY → credential source gate blocks refresh
    const client = createClient({
      providerOverride: { model: 'gpt-5', baseURL: 'https://api.githubcopilot.com', apiKey: 'override-token' },
    }) as OpenAIShimClient

    await expect(
      client.beta.messages.create({
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 32,
        stream: false,
      }),
    ).rejects.toThrow()

    expect(refreshSpy).toHaveBeenCalledTimes(0)
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realGithubModule)
  }
})

test('GitHub Copilot 401 chat_completions with providerOverride does not trigger refresh', async () => {
  const realGithubModule = realGithubModelsCredentials
  try {
    const refreshSpy = mock(async () => {
      process.env.GITHUB_TOKEN = 'refreshed-token'
      process.env.OPENAI_API_KEY = 'refreshed-token'
      return true
    })

    mock.module('../../utils/githubModelsCredentials.js', () => ({
      ...realGithubModule,
      refreshCopilotTokenOn401: refreshSpy,
    }))

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://api.githubcopilot.com'
    process.env.OPENAI_API_KEY = 'stored-copilot-token'
    process.env.GITHUB_TOKEN = 'stored-copilot-token'

    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: 'token expired' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      )) as unknown as typeof globalThis.fetch

    const { createOpenAIShimClient: createClient } =
      await importFreshOpenAIShim('copilot-401-override-chat')

    // providerOverride.apiKey differs from OPENAI_API_KEY → credential source gate blocks refresh
    const client = createClient({
      providerOverride: { model: 'gpt-4', baseURL: 'https://api.githubcopilot.com', apiKey: 'override-token' },
    }) as OpenAIShimClient

    await expect(
      client.beta.messages.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 32,
        stream: false,
      }),
    ).rejects.toThrow()

    expect(refreshSpy).toHaveBeenCalledTimes(0)
  } finally {
    mock.module('../../utils/githubModelsCredentials.js', () => realGithubModule)
  }
})

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

test('JSON fallback: preserves tool_calls as a tool_use block', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-tool',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'Bash', arguments: '{"command":"pwd"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
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
    id: 'call_1',
    name: 'Bash',
  })

  const inputDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'input_json_delta',
  ) as { delta?: { partial_json?: string } } | undefined
  expect(JSON.parse(inputDelta?.delta?.partial_json ?? '{}')).toEqual({
    command: 'pwd',
  })

  const stopEvent = events.find(e => e.type === 'message_delta') as
    | { delta?: { stop_reason?: string } }
    | undefined
  expect(stopEvent?.delta?.stop_reason).toBe('tool_use')
})

test('JSON fallback: maps finish_reason=length to max_tokens', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-len',
    model: 'fake-model',
    choices: [
      { message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' },
    ],
  })
  const stopEvent = events.find(e => e.type === 'message_delta') as
    | { delta?: { stop_reason?: string } }
    | undefined
  expect(stopEvent?.delta?.stop_reason).toBe('max_tokens')
})

test('JSON fallback: preserves OpenCode Go quota error guidance', async () => {
  process.env.OPENAI_BASE_URL = 'https://opencode.ai/zen/go/v1'
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    withResponseUrl(
      makeJsonChatCompletion({
        error: {
          type: 'FreeUsageLimitError',
          message: 'free usage limit reached',
        },
      }),
      'https://opencode.ai/zen/go/v1/chat/completions',
    )) as unknown as FetchType

  try {
    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'fake-model',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    let caught: unknown
    try {
      for await (const _event of result.data) {
        // Consume until the JSON error is surfaced.
      }
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(APIError)
    const apiError = caught as APIError
    expect(apiError.headers?.get('x-opencode-request-url')).toBe(
      'https://opencode.ai/zen/go/v1/chat/completions',
    )
    const message = getAssistantMessageFromError(apiError, 'glm-5.1')
    const first = message.message.content[0]
    expect(typeof first === 'object' && first && 'text' in first ? first.text : '').toBe(
      OPENCODE_GO_FREE_LIMIT_ERROR_MESSAGE,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('JSON fallback: strips <think> tags from emitted text', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-think',
    model: 'fake-model',
    choices: [
      {
        message: { role: 'assistant', content: '<think>private plan</think>visible answer' },
        finish_reason: 'stop',
      },
    ],
  })
  const textDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'text_delta',
  ) as { delta?: { text?: string } } | undefined
  expect(textDelta?.delta?.text).toBe('visible answer')
  expect(textDelta?.delta?.text).not.toContain('private plan')
})

test('JSON fallback: normalizes array content into a text string', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-array',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ],
        },
        finish_reason: 'stop',
      },
    ],
  })
  const textDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'text_delta',
  ) as { delta?: { text?: unknown } } | undefined
  expect(typeof textDelta?.delta?.text).toBe('string')
  expect(textDelta?.delta?.text).toBe('line one\nline two')
})

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

test('JSON fallback: preserves HY3-looking text for non-Tencent model names', async () => {
  const text =
    '<tool_call:example>TaskCreate\nsubject: merely a documentation example\n</tool_call:example>'
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-non-tencent-hy3',
    model: 'other/hy3-documentation',
    choices: [
      {
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
  }, 'other/hy3-documentation')
  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  )
  const textDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'text_delta',
  ) as { delta?: { text?: string } } | undefined

  expect(toolStart).toBeUndefined()
  expect(textDelta?.delta?.text).toBe(text)
})

test('JSON fallback: empty tool_calls array does not block raw-text recovery', async () => {
  // tool_calls: [] is truthy; it must be treated as "no structured tool calls"
  // so the raw "Tool calls requested" recovery still runs.
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-empty-tc',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          tool_calls: [],
          content:
            'Tool calls requested:\n- Bash({"command":"ls"}) [id: call_empty_tc]',
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
    id: 'call_empty_tc',
    name: 'Bash',
  })
})

test('JSON fallback: empty tool_calls does not block raw-text recovery on array content', async () => {
  // Companion to the string-content case above: the array-content branch must
  // also treat tool_calls: [] as "no structured tool calls" so raw recovery runs.
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-empty-tc-array',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          tool_calls: [],
          content: [
            { type: 'text', text: 'Tool calls requested:' },
            { type: 'text', text: '- Bash({"command":"ls"}) [id: call_empty_tc_arr]' },
          ],
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
    id: 'call_empty_tc_arr',
    name: 'Bash',
  })
})

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type {
  BetaMessage,
  BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { resetGrowthBook } from '../analytics/growthbook.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { QueryLifecycleOperationTracker } from '../../utils/queryLifecycle.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import {
  executeNonStreamingRequest,
  type Options,
  queryModelWithStreaming,
} from './claude.js'
import { EMPTY_USAGE } from './emptyUsage.js'

const envKeys = [
  'AIMLAPI_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_TEST_FIXTURES_ROOT',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
  'CLAUDE_FEATURE_FLAGS_FILE',
  'CLAUDE_STREAM_IDLE_TIMEOUT_MS',
  'GEMINI_API_KEY',
  'LONGCAT_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENCLAUDE_MAX_RETRIES',
  'VCR_RECORD',
] as const
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const hadSavedMacro = Object.hasOwn(globalThis, 'MACRO')
const savedMacro = (globalThis as Record<string, unknown>).MACRO
let fixturesRoot: string | undefined

type FetchOverride = NonNullable<Options['fetchOverride']>
type LifecycleSnapshot = ReturnType<QueryLifecycleOperationTracker['snapshot']>
const TEST_STREAM_IDLE_TIMEOUT_MS = 25
const STREAM_IDLE_RECOVERY_ASSERTION_MS = 1_000
const STALLING_STREAM_CLEANUP_MS = 2_000

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'request-id': `req-${status}`,
    },
  })
}

function makeErrorResponse(status: number, message: string): Response {
  return makeJsonResponse(
    {
      type: 'error',
      error: {
        type: 'api_error',
        message,
      },
    },
    status,
  )
}

function makeBetaMessage(): BetaMessage {
  return {
    id: 'msg-lifecycle-test',
    type: 'message',
    role: 'assistant',
    model: 'claude-lifecycle-test',
    content: [],
    container: null,
    context_management: null,
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      ...EMPTY_USAGE,
      input_tokens: 1,
      output_tokens: 1,
    },
  }
}

function makeOpenAIChatCompletionResponse(): Response {
  return makeJsonResponse({
    id: 'chatcmpl-lifecycle-fallback',
    object: 'chat.completion',
    created: 1_771_264_800,
    model: 'gpt-override',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'fallback ok',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  })
}

function makeOpenAIStreamChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-lifecycle-stream',
    object: 'chat.completion.chunk',
    created: 1_771_264_800,
    model: 'glm-5.2',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

function makeStallingOpenAIStreamResponse(
  onCancel?: (reason: unknown) => void,
): Response {
  const encoder = new TextEncoder()
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            makeOpenAIStreamChunk({ role: 'assistant', content: 'partial' }),
          ),
        )
        // Bounded cleanup for current/baseline behavior: the idle-timeout
        // assertions should fail before this close fires.
        closeTimer = setTimeout(() => {
          try {
            controller.close()
          } catch {
            // stream may already be cancelled by the idle timeout path
          }
        }, STALLING_STREAM_CLEANUP_MS)
      },
      cancel(reason) {
        if (closeTimer !== undefined) {
          clearTimeout(closeTimer)
        }
        onCancel?.(reason)
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream',
      },
    },
  )
}

function makeRoleOnlyStallingOpenAIStreamResponse(
  onInitialChunk: () => void,
  onCancel?: (reason: unknown) => void,
): Response {
  const encoder = new TextEncoder()
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let sentInitialChunk = false

  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentInitialChunk) return
        sentInitialChunk = true
        controller.enqueue(
          encoder.encode(makeOpenAIStreamChunk({ role: 'assistant' })),
        )
        onInitialChunk()
        closeTimer = setTimeout(() => {
          try {
            controller.close()
          } catch {
            // stream may already be cancelled by the abort path
          }
        }, 500)
      },
      cancel(reason) {
        if (closeTimer !== undefined) {
          clearTimeout(closeTimer)
        }
        onCancel?.(reason)
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream',
      },
    },
  )
}

function parseRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {}
  const parsed = JSON.parse(init.body) as unknown
  return parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : {}
}

async function drainGenerator<T>(
  generator: AsyncGenerator<unknown, T>,
): Promise<T> {
  while (true) {
    const result = await generator.next()
    if (result.done) return result.value
  }
}

async function waitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function makeParams(context: { model: string }): BetaMessageStreamParams {
  return {
    model: context.model,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hello' }],
  } as BetaMessageStreamParams
}

function makeOptions(
  queryLifecycle: QueryLifecycleOperationTracker,
): Options {
  return {
    getToolPermissionContext: async () => getEmptyToolPermissionContext(),
    model: 'claude-lifecycle-test',
    isNonInteractiveSession: false,
    querySource: 'sdk',
    agents: [],
    hasAppendSystemPrompt: false,
    mcpTools: [],
    queryLifecycle,
  }
}

function setTestMacro(): void {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '0.0.0-test',
    DISPLAY_VERSION: '0.0.0-test',
    BUILD_TIME: 'test',
    ISSUES_EXPLAINER: 'test',
    PACKAGE_URL: 'test',
    NATIVE_PACKAGE_URL: undefined,
  }
}

function setClientTestEnv(): void {
  setTestMacro()
  fixturesRoot = mkdtempSync(join(tmpdir(), 'claude-lifecycle-vcr-'))
  for (const key of envKeys) {
    delete process.env[key]
  }
  process.env.ANTHROPIC_API_KEY = 'sk-test-lifecycle'
  process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixturesRoot
  process.env.CLAUDE_FEATURE_FLAGS_FILE = join(
    fixturesRoot,
    'feature-flags.json',
  )
  process.env.VCR_RECORD = '1'
  resetGrowthBook()
}

beforeEach(async () => {
  await acquireSharedMutationLock('claude.lifecycle.test.ts')
})

afterEach(() => {
  try {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
    if (hadSavedMacro) {
      ;(globalThis as Record<string, unknown>).MACRO = savedMacro
    } else {
      delete (globalThis as Record<string, unknown>).MACRO
    }
    globalThis.fetch = originalFetch
    resetGrowthBook()
    if (fixturesRoot) {
      rmSync(fixturesRoot, { force: true, recursive: true })
      fixturesRoot = undefined
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('Claude API lifecycle tracking', () => {
  test('ends a failed streaming dispatch before retry backoff is reported', async () => {
    setClientTestEnv()
    process.env.OPENCLAUDE_MAX_RETRIES = '1'
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const dispatchSnapshots: ReturnType<
      QueryLifecycleOperationTracker['snapshot']
    >[] = []
    const fetchOverride: FetchOverride = async () => {
      dispatchSnapshots.push(queryLifecycle.snapshot())
      return makeErrorResponse(500, 'stream dispatch failed')
    }

    const generator = queryModelWithStreaming({
      messages: [
        {
          type: 'user',
          uuid: '00000000-0000-0000-0000-000000000001',
          timestamp: '2026-06-17T00:00:00.000Z',
          message: { role: 'user', content: 'hello' },
        } as Message,
      ],
      systemPrompt: asSystemPrompt([]),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: new AbortController().signal,
      options: {
        ...makeOptions(queryLifecycle),
        fetchOverride,
      },
    })

    const first = await generator.next()
    expect(first.done).toBe(false)
    expect(first.value).toMatchObject({
      type: 'system',
      subtype: 'api_error',
    })
    expect(dispatchSnapshots.length).toBeGreaterThanOrEqual(1)
    expect(dispatchSnapshots.some(snapshot => snapshot.apiCalls.length === 1)).toBe(
      true,
    )
    expect(queryLifecycle.snapshot().apiCalls).toEqual([])

    await generator.return(undefined)
  })

  test('preserves provider override and query source during 404 non-streaming fallback', async () => {
    setClientTestEnv()
    process.env.OPENCLAUDE_MAX_RETRIES = '0'
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const providerBaseURL = 'https://provider.example/v1'
    const requests: {
      authorization: string | null
      snapshot: LifecycleSnapshot
      stream: unknown
      url: string
    }[] = []

    globalThis.fetch = (async (input, init) => {
      const body = parseRequestBody(init)
      requests.push({
        authorization: new Headers(init?.headers).get('authorization'),
        snapshot: queryLifecycle.snapshot(),
        stream: body.stream,
        url: input instanceof Request ? input.url : String(input),
      })

      if (body.stream === true) {
        return makeErrorResponse(404, 'streaming unavailable')
      }

      return makeOpenAIChatCompletionResponse()
    }) as typeof fetch

    const messages: unknown[] = []
    const generator = queryModelWithStreaming({
      messages: [
        {
          type: 'user',
          uuid: '00000000-0000-0000-0000-000000000002',
          timestamp: '2026-06-17T00:00:00.000Z',
          message: { role: 'user', content: 'hello' },
        } as Message,
      ],
      systemPrompt: asSystemPrompt([]),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: new AbortController().signal,
      options: {
        ...makeOptions(queryLifecycle),
        providerOverride: {
          model: 'gpt-override',
          baseURL: providerBaseURL,
          apiKey: 'provider-test-key',
        },
      },
    })

    for await (const message of generator) {
      messages.push(message)
    }

    const streamingRequest = requests.find(request => request.stream === true)
    const fallbackRequest = requests.find(request => request.stream === false)

    expect(
      messages.some(
        message =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: unknown }).type === 'assistant',
      ),
    ).toBe(true)
    expect(streamingRequest?.url.startsWith(providerBaseURL)).toBe(true)
    expect(fallbackRequest?.url.startsWith(providerBaseURL)).toBe(true)
    expect(fallbackRequest?.authorization).toBe('Bearer provider-test-key')
    expect(fallbackRequest?.snapshot.apiCalls).toHaveLength(1)
    expect(fallbackRequest?.snapshot.apiCalls[0]).toMatchObject({
      querySource: 'sdk',
    })
    expect(queryLifecycle.snapshot().apiCalls).toEqual([])
  })

  test('parent abort during OpenAI-compatible stream does not start non-streaming fallback', async () => {
    setClientTestEnv()
    process.env.OPENCLAUDE_MAX_RETRIES = '0'
    process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '1000'
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const parent = new AbortController()
    let fallbackRequests = 0
    let fallbackNotifications = 0
    let streamCancelled = false
    const messages: unknown[] = []
    let resolveStreamingRequestStarted!: () => void
    const streamingRequestStarted = new Promise<void>(resolve => {
      resolveStreamingRequestStarted = resolve
    })
    let resolveInitialStreamChunk!: () => void
    const initialStreamChunk = new Promise<void>(resolve => {
      resolveInitialStreamChunk = resolve
    })

    globalThis.fetch = (async (_input, init) => {
      const body = parseRequestBody(init)
      if (body.stream === true) {
        resolveStreamingRequestStarted()
        return makeRoleOnlyStallingOpenAIStreamResponse(
          resolveInitialStreamChunk,
          () => {
            streamCancelled = true
          },
        )
      }
      fallbackRequests++
      return makeOpenAIChatCompletionResponse()
    }) as typeof fetch

    let drainError: unknown
    const drain = (async () => {
      try {
        const generator = queryModelWithStreaming({
          messages: [
            {
              type: 'user',
              uuid: '00000000-0000-0000-0000-000000000006',
              timestamp: '2026-06-17T00:00:00.000Z',
              message: { role: 'user', content: 'hello' },
            } as Message,
          ],
          systemPrompt: asSystemPrompt([]),
          thinkingConfig: { type: 'disabled' },
          tools: [],
          signal: parent.signal,
          options: {
            ...makeOptions(queryLifecycle),
            providerOverride: {
              model: 'glm-5.2',
              baseURL: 'https://provider.example/v1',
              apiKey: 'provider-test-key',
            },
            onStreamingFallback: () => {
              fallbackNotifications++
            },
          },
        })

        for await (const message of generator) {
          messages.push(message)
        }
      } catch (error) {
        drainError = error
      }
    })()

    await streamingRequestStarted
    await initialStreamChunk
    await Promise.resolve()
    parent.abort()

    await drain

    expect(drainError).toBeUndefined()
    expect(fallbackRequests).toBe(0)
    expect(fallbackNotifications).toBe(0)
    expect(streamCancelled).toBe(true)
    expect(
      messages.some(
        message =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: unknown }).type === 'assistant',
      ),
    ).toBe(false)
  })

  test('stream idle timeout respects disabled non-streaming fallback guard', async () => {
    setClientTestEnv()
    process.env.OPENCLAUDE_MAX_RETRIES = '0'
    process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = String(TEST_STREAM_IDLE_TIMEOUT_MS)
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const parent = new AbortController()
    let fallbackRequests = 0
    const messages: unknown[] = []
    const startedAt = Date.now()

    globalThis.fetch = (async (_input, init) => {
      const body = parseRequestBody(init)
      if (body.stream === true) {
        return makeStallingOpenAIStreamResponse()
      }
      fallbackRequests++
      return makeOpenAIChatCompletionResponse()
    }) as typeof fetch

    let drainError: unknown
    const drain = (async () => {
      try {
        const generator = queryModelWithStreaming({
          messages: [
            {
              type: 'user',
              uuid: '00000000-0000-0000-0000-000000000007',
              timestamp: '2026-06-17T00:00:00.000Z',
              message: { role: 'user', content: 'hello' },
            } as Message,
          ],
          systemPrompt: asSystemPrompt([]),
          thinkingConfig: { type: 'disabled' },
          tools: [],
          signal: parent.signal,
          options: {
            ...makeOptions(queryLifecycle),
            providerOverride: {
              model: 'glm-5.2',
              baseURL: 'https://provider.example/v1',
              apiKey: 'provider-test-key',
            },
          },
        })

        for await (const message of generator) {
          messages.push(message)
        }
      } catch (error) {
        drainError = error
      }
    })()

    await drain
    expect(Date.now() - startedAt).toBeLessThan(
      TEST_STREAM_IDLE_TIMEOUT_MS + STREAM_IDLE_RECOVERY_ASSERTION_MS,
    )

    expect(drainError).toBeUndefined()
    expect(fallbackRequests).toBe(0)
    expect(
      messages.some(
        message =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: unknown }).type === 'assistant' &&
          JSON.stringify((message as { message?: { content?: unknown } }).message?.content).includes('Stream idle timeout'),
      ),
    ).toBe(true)
  })

  test('tracks each non-streaming fallback request and clears it on success', async () => {
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const requestSnapshots: ReturnType<
      QueryLifecycleOperationTracker['snapshot']
    >[] = []
    setClientTestEnv()
    const fetchOverride: FetchOverride = async () => {
      requestSnapshots.push(queryLifecycle.snapshot())
      return makeJsonResponse(makeBetaMessage())
    }

    const result = await drainGenerator(
      executeNonStreamingRequest(
        { model: 'claude-lifecycle-test', source: 'sdk', fetchOverride },
        {
          model: 'claude-lifecycle-test',
          thinkingConfig: { type: 'disabled' },
          signal: new AbortController().signal,
          querySource: 'sdk',
        },
        makeParams,
        () => {},
        () => {},
        null,
        queryLifecycle,
      ),
    )

    expect(result.id).toBe('msg-lifecycle-test')
    expect(requestSnapshots).toHaveLength(1)
    expect(requestSnapshots[0]?.apiCalls).toHaveLength(1)
    expect(requestSnapshots[0]?.apiCalls[0]).toMatchObject({
      model: 'claude-lifecycle-test',
      querySource: 'sdk',
    })
    expect(queryLifecycle.snapshot().apiCalls).toEqual([])
  })

  test('clears non-streaming fallback lifecycle entries after request errors', async () => {
    setClientTestEnv()
    process.env.OPENCLAUDE_MAX_RETRIES = '0'
    const queryLifecycle = new QueryLifecycleOperationTracker()
    const requestSnapshots: ReturnType<
      QueryLifecycleOperationTracker['snapshot']
    >[] = []
    const fetchOverride: FetchOverride = async () => {
      requestSnapshots.push(queryLifecycle.snapshot())
      return makeErrorResponse(400, 'fallback failed')
    }

    await expect(
      drainGenerator(
        executeNonStreamingRequest(
          { model: 'claude-lifecycle-test', source: 'sdk', fetchOverride },
          {
            model: 'claude-lifecycle-test',
            thinkingConfig: { type: 'disabled' },
            signal: new AbortController().signal,
            querySource: 'sdk',
          },
          makeParams,
          () => {},
          () => {},
          null,
          queryLifecycle,
        ),
      ),
    ).rejects.toThrow('fallback failed')

    expect(requestSnapshots).toHaveLength(1)
    expect(requestSnapshots[0]?.apiCalls).toHaveLength(1)
    expect(queryLifecycle.snapshot().apiCalls).toEqual([])
  })
})

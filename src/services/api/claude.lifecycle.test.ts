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
  'GEMINI_API_KEY',
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
  process.env.VCR_RECORD = '1'
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

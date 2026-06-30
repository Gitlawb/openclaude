import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { QueryLifecycleOperationTracker } from '../../utils/queryLifecycle.js'
import { EMPTY_USAGE } from './emptyUsage.js'
import type { Options } from './claude.js'

const actualClientModule = await import('./client.js')
const originalEnv = { ...process.env }
const hadSavedMacro = Object.hasOwn(globalThis, 'MACRO')
const savedMacro = (globalThis as Record<string, unknown>).MACRO
let fixturesRoot: string | undefined
const envKeys = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
  'CLAUDE_CODE_TEST_FIXTURES_ROOT',
  'CLAUDE_DISABLE_STREAM_WATCHDOG',
  'CLAUDE_ENABLE_STREAM_WATCHDOG',
  'CLAUDE_STREAM_IDLE_TIMEOUT_MS',
  'OPENCLAUDE_MAX_RETRIES',
  'VCR_RECORD',
] as const

type CreateArgs = [
  Record<string, unknown>,
  Record<string, unknown> | undefined,
]
type CreateHandler = (...args: CreateArgs) => unknown

let createHandler: CreateHandler | undefined
let importCounter = 0

mock.module('./client.js', () => ({
  CLIENT_REQUEST_ID_HEADER: actualClientModule.CLIENT_REQUEST_ID_HEADER,
  getAnthropicClient: async () => ({
    beta: {
      messages: {
        create: (...args: CreateArgs) => {
          if (!createHandler) {
            throw new Error('test client create handler not configured')
          }
          return createHandler(...args)
        },
      },
    },
  }),
}))

function makeBetaMessage(
  id: string,
  content: BetaMessage['content'] = [],
): BetaMessage {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-watchdog-test',
    content,
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

function makeMessageStartEvent(): BetaRawMessageStreamEvent {
  return {
    type: 'message_start',
    message: makeBetaMessage('msg-stream-start'),
  }
}

function makeCompleteStreamEvents(): BetaRawMessageStreamEvent[] {
  return [
    makeMessageStartEvent(),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: null },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'stream ok' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      context_management: null,
      delta: {
        container: null,
        stop_details: null,
        stop_reason: 'end_turn',
        stop_sequence: null,
      },
      usage: {
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        input_tokens: null,
        iterations: null,
        output_tokens: 1,
        server_tool_use: null,
      },
    },
    { type: 'message_stop' },
  ]
}

function deferred<T>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

function makeWedgedStream(): {
  abortSignal: AbortSignal
  nextStarted: Promise<void>
  rejectPendingNext: (error: Error) => void
  returnCalled: () => boolean
  stream: Stream<BetaRawMessageStreamEvent>
} {
  const controller = new AbortController()
  const pendingNext = deferred<IteratorResult<BetaRawMessageStreamEvent>>()
  const nextStarted = deferred<void>()
  let nextCount = 0
  let returned = false
  const iterator: AsyncIterator<BetaRawMessageStreamEvent> = {
    next() {
      nextCount++
      if (nextCount === 1) {
        return Promise.resolve({
          done: false,
          value: makeMessageStartEvent(),
        })
      }
      nextStarted.resolve()
      return pendingNext.promise
    },
    return() {
      returned = true
      return Promise.resolve({ done: true, value: undefined })
    },
  }

  return {
    abortSignal: controller.signal,
    nextStarted: nextStarted.promise,
    rejectPendingNext: error => pendingNext.reject(error),
    returnCalled: () => returned,
    stream: {
      controller,
      [Symbol.asyncIterator]: () => iterator,
    } as Stream<BetaRawMessageStreamEvent>,
  }
}

function makeCompleteStream(): Stream<BetaRawMessageStreamEvent> {
  const controller = new AbortController()
  const events = makeCompleteStreamEvents()
  const iterator: AsyncIterator<BetaRawMessageStreamEvent> = {
    next() {
      const value = events.shift()
      return Promise.resolve(
        value === undefined
          ? { done: true, value: undefined }
          : { done: false, value },
      )
    },
  }

  return {
    controller,
    [Symbol.asyncIterator]: () => iterator,
  } as Stream<BetaRawMessageStreamEvent>
}

function makeWithResponse(stream: Stream<BetaRawMessageStreamEvent>) {
  return {
    withResponse: async () => ({
      data: stream,
      request_id: 'req-stream-watchdog',
      response: new Response('', {
        headers: { 'request-id': 'req-stream-watchdog' },
      }),
    }),
  }
}

function makeOptions(onStreamingFallback?: () => void): Options {
  return {
    getToolPermissionContext: async () => getEmptyToolPermissionContext(),
    model: 'claude-watchdog-test',
    isNonInteractiveSession: false,
    querySource: 'sdk',
    agents: [],
    hasAppendSystemPrompt: false,
    mcpTools: [],
    onStreamingFallback,
    queryLifecycle: new QueryLifecycleOperationTracker(),
  }
}

function makeMessages(): Message[] {
  return [
    {
      type: 'user',
      uuid: '00000000-0000-0000-0000-000000000101',
      timestamp: '2026-06-30T00:00:00.000Z',
      message: { role: 'user', content: 'hello' },
    } as Message,
  ]
}

async function collectStreamingMessages(
  signal: AbortSignal,
  options: Options,
): Promise<unknown[]> {
  const { queryModelWithStreaming } = await import(
    `./claude.js?stream-watchdog-test-${importCounter++}`
  )
  const messages: unknown[] = []
  for await (const message of queryModelWithStreaming({
    messages: makeMessages(),
    systemPrompt: asSystemPrompt([]),
    thinkingConfig: { type: 'disabled' },
    tools: [],
    signal,
    options,
  })) {
    messages.push(message)
  }
  return messages
}

function delay(ms: number): Promise<'timeout'> {
  return new Promise(resolve => {
    setTimeout(() => resolve('timeout'), ms)
  })
}

async function settleForCleanup(promise: Promise<unknown>): Promise<void> {
  await Promise.race([promise.catch(() => undefined), delay(50)])
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

beforeEach(async () => {
  await acquireSharedMutationLock('claude.streamWatchdog.test.ts')
  setTestMacro()
  for (const key of envKeys) {
    delete process.env[key]
  }
  fixturesRoot = mkdtempSync(join(tmpdir(), 'claude-watchdog-vcr-'))
  process.env.ANTHROPIC_API_KEY = 'sk-test-watchdog'
  process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixturesRoot
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '25'
  process.env.OPENCLAUDE_MAX_RETRIES = '0'
  process.env.VCR_RECORD = '1'
})

afterEach(() => {
  try {
    createHandler = undefined
    for (const key of envKeys) {
      const envKey: string = key
      if (
        envKey === '__proto__' ||
        envKey === 'constructor' ||
        envKey === 'prototype'
      ) {
        continue
      }

      if (originalEnv[envKey] === undefined) {
        delete process.env[envKey]
      } else {
        process.env[envKey] = originalEnv[envKey]
      }
    }
    if (hadSavedMacro) {
      ;(globalThis as Record<string, unknown>).MACRO = savedMacro
    } else {
      delete (globalThis as Record<string, unknown>).MACRO
    }
    if (fixturesRoot) {
      rmSync(fixturesRoot, { force: true, recursive: true })
      fixturesRoot = undefined
    }
  } finally {
    releaseSharedMutationLock()
  }
})

afterAll(() => {
  mock.module('./client.js', () => actualClientModule)
})

describe('Claude stream watchdog', () => {
  test('falls back when the top-level stream iterator never settles', async () => {
    const wedged = makeWedgedStream()
    const streamModes: unknown[] = []
    createHandler = params => {
      streamModes.push(params.stream)
      if (params.stream === true) {
        return makeWithResponse(wedged.stream)
      }
      return Promise.resolve(
        makeBetaMessage('msg-fallback', [
          { type: 'text', text: 'fallback ok', citations: null },
        ]),
      )
    }

    const request = collectStreamingMessages(
      new AbortController().signal,
      makeOptions(),
    )
    await wedged.nextStarted

    try {
      const result = await Promise.race([request, delay(250)])
      expect(result).not.toBe('timeout')
      expect(streamModes).toEqual([true, undefined])
      expect(wedged.abortSignal.aborted).toBe(true)
      expect(wedged.returnCalled()).toBe(true)
      expect(
        (result as unknown[]).some(
          message =>
            typeof message === 'object' &&
            message !== null &&
            (message as { type?: unknown }).type === 'assistant',
        ),
      ).toBe(true)
    } finally {
      wedged.rejectPendingNext(new Error('test cleanup'))
      await settleForCleanup(request)
    }
  })

  test('does not attempt fallback when the parent signal aborts first', async () => {
    process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '250'
    const wedged = makeWedgedStream()
    const controller = new AbortController()
    const streamModes: unknown[] = []
    createHandler = params => {
      streamModes.push(params.stream)
      if (params.stream === true) {
        return makeWithResponse(wedged.stream)
      }
      return Promise.resolve(
        makeBetaMessage('msg-unexpected-fallback', [
          { type: 'text', text: 'unexpected fallback', citations: null },
        ]),
      )
    }

    const request = collectStreamingMessages(controller.signal, makeOptions())
      .then(() => 'resolved')
      .catch(error =>
        error instanceof Error ? error.name : String(error),
      )
    await wedged.nextStarted
    controller.abort()

    try {
      const result = await Promise.race([request, delay(150)])
      expect(result).toBe('resolved')
      expect(streamModes).toEqual([true])
      expect(wedged.abortSignal.aborted).toBe(true)
      expect(wedged.returnCalled()).toBe(true)
    } finally {
      wedged.rejectPendingNext(new Error('test cleanup'))
      await settleForCleanup(request)
    }
  })

  test('complete streams still produce the streamed assistant message', async () => {
    const streamModes: unknown[] = []
    let fallbackCount = 0
    createHandler = params => {
      streamModes.push(params.stream)
      if (params.stream === true) {
        return makeWithResponse(makeCompleteStream())
      }
      fallbackCount++
      return Promise.resolve(
        makeBetaMessage('msg-unexpected-fallback', [
          { type: 'text', text: 'unexpected fallback', citations: null },
        ]),
      )
    }

    const messages = await collectStreamingMessages(
      new AbortController().signal,
      makeOptions(),
    )

    expect(streamModes).toEqual([true])
    expect(fallbackCount).toBe(0)
    expect(
      messages.some(
        message =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: unknown }).type === 'assistant' &&
          JSON.stringify(message).includes('stream ok'),
      ),
    ).toBe(true)
  })

  test('late rejection from an abandoned iterator read is observed', async () => {
    const wedged = makeWedgedStream()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    createHandler = params => {
      if (params.stream === true) {
        return makeWithResponse(wedged.stream)
      }
      return Promise.resolve(
        makeBetaMessage('msg-fallback', [
          { type: 'text', text: 'fallback ok', citations: null },
        ]),
      )
    }

    const request = collectStreamingMessages(
      new AbortController().signal,
      makeOptions(),
    )
    await wedged.nextStarted

    try {
      const result = await Promise.race([request, delay(250)])
      expect(result).not.toBe('timeout')
      wedged.rejectPendingNext(new Error('late iterator failure'))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
      wedged.rejectPendingNext(new Error('test cleanup'))
      await settleForCleanup(request)
    }
  })
})

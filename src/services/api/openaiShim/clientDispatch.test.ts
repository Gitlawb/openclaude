import { expect, test } from 'bun:test'
import type { AnthropicStreamEvent, ShimCreateParams } from '../codexShim.js'
import {
  createShimRequest,
  headersWithRequestUrl,
  OpenAIShimStream,
  type ClientDispatchDependencies,
} from './clientDispatch.js'

function responseAt(
  url: string,
  body: BodyInit | null = null,
  init: ResponseInit = {},
): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'url', { value: url, configurable: true })
  return response
}

async function collect(stream: AsyncIterable<AnthropicStreamEvent>) {
  const events: AnthropicStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function makeParams(stream: boolean): ShimCreateParams {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream,
  }
}

function makeDependencies(
  response: Response,
  calls: string[],
  overrides: Partial<ClientDispatchDependencies> = {},
): ClientDispatchDependencies {
  const converter = (name: string) => async function* () {
    calls.push(name)
    yield { type: name }
  }
  return {
    providerOverride: {
      model: 'test-model',
      baseURL: 'https://api.example.test/v1',
      apiKey: 'test-key',
    },
    doRequest: async () => response,
    convertNonStreamingResponse: data => ({ converted: 'openai', data }),
    convertGeminiResponse: data => ({ converted: 'gemini', data }),
    createStreamAbortError: () => new DOMException('Aborted', 'AbortError'),
    anthropicSsePassthrough: converter('messages'),
    geminiSseToAnthropic: converter('gemini'),
    openaiStreamToAnthropic: converter('openai'),
    isGithubModelsMode: () => false,
    makeMessageId: () => 'msg_test',
    ...overrides,
  }
}

test('headersWithRequestUrl clones headers and preserves request routing metadata', () => {
  const original = new Headers({ 'x-request-id': 'request-1' })
  const result = headersWithRequestUrl(
    original,
    'https://provider.example/v1/chat/completions?token=secret',
  )
  expect(result).not.toBe(original)
  expect(result.get('x-request-id')).toBe('request-1')
  expect(result.get('x-opencode-request-url')).toBe(
    'https://provider.example/v1/chat/completions?token=secret',
  )
  expect(original.has('x-opencode-request-url')).toBe(false)
})

test('headersWithRequestUrl does not add an empty routing header', () => {
  expect(headersWithRequestUrl(new Headers()).has('x-opencode-request-url')).toBe(false)
})

test('OpenAIShimStream combines parent and controller cancellation', async () => {
  const parent = new AbortController()
  let receivedSignal: AbortSignal | undefined
  const stream = new OpenAIShimStream(async function* (signal) {
    receivedSignal = signal
    yield { type: 'message_start' }
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    })
  }, parent.signal)
  const iterator = stream[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({
    done: false,
    value: { type: 'message_start' },
  })
  const pending = iterator.next()
  await Promise.resolve()
  parent.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(receivedSignal?.aborted).toBe(true)
})

test('OpenAIShimStream cancels the response before iteration starts', () => {
  let cancellations = 0
  const stream = new OpenAIShimStream(
    async function* () {
      yield { type: 'unused' }
    },
    undefined,
    () => {
      cancellations++
    },
  )
  stream.controller.abort()
  expect(cancellations).toBe(1)
})

test('OpenAIShimStream aborts its controller when a consumer returns early', async () => {
  const stream = new OpenAIShimStream(async function* () {
    yield { type: 'first' }
    yield { type: 'second' }
  })
  for await (const _event of stream) break
  expect(stream.controller.signal.aborted).toBe(true)
})

test.each([
  ['messages', 'https://provider.example/v1/messages'],
  ['gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent'],
  ['openai', 'https://provider.example/v1/chat/completions'],
])('dispatches a %s stream by response URL', async (expected, url) => {
  const calls: string[] = []
  const request = createShimRequest(
    makeParams(true),
    undefined,
    makeDependencies(
      responseAt(url, 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
      calls,
    ),
  )
  const stream = await request as AsyncIterable<AnthropicStreamEvent>
  expect((await collect(stream)).map(event => event.type)).toEqual([expected])
  expect(calls).toEqual([expected])
})

test('passes Anthropic Messages JSON through without conversion', async () => {
  const calls: string[] = []
  const payload = { id: 'msg_provider', type: 'message', content: [] }
  const result = await createShimRequest(
    makeParams(false),
    undefined,
    makeDependencies(
      responseAt('https://provider.example/v1/messages', JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    ),
  )
  expect(result).toEqual(payload)
  expect(calls).toEqual([])
})

test('dispatches Gemini and generic non-streaming JSON conversion', async () => {
  const gemini = await createShimRequest(
    makeParams(false),
    undefined,
    makeDependencies(
      responseAt(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
        '{"candidates":[]}',
        { headers: { 'content-type': 'application/json' } },
      ),
      [],
    ),
  )
  expect(gemini).toEqual({ converted: 'gemini', data: { candidates: [] } })

  const openai = await createShimRequest(
    makeParams(false),
    undefined,
    makeDependencies(
      responseAt(
        'https://provider.example/v1/chat/completions',
        '{"choices":[]}',
        { headers: { 'content-type': 'application/json' } },
      ),
      [],
    ),
  )
  expect(openai).toEqual({ converted: 'openai', data: { choices: [] } })
})

test('withResponse exposes the exact HTTP response and request id', async () => {
  const response = responseAt(
    'https://provider.example/v1/chat/completions',
    '{"choices":[]}',
    {
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'provider-request-id',
      },
    },
  )
  const request = createShimRequest(
    makeParams(false),
    undefined,
    makeDependencies(response, []),
  )
  const wrapped = await request.withResponse()
  expect(wrapped.response).toBe(response)
  expect(wrapped.request_id).toBe('provider-request-id')
  expect(wrapped.data).toEqual({ converted: 'openai', data: { choices: [] } })
})

test('rejects an unexpected non-JSON provider response', async () => {
  const request = createShimRequest(
    makeParams(false),
    undefined,
    makeDependencies(
      responseAt('https://provider.example/v1/chat/completions', 'not json', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
      [],
    ),
  )
  await expect(request).rejects.toThrow(
    'unexpected response content-type: text/plain',
  )
})

import { expect, test } from 'bun:test'

import { AnthropicVertex } from './vertexClient.js'

test('routes message requests through Vertex rawPredict with auth headers', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined
  let capturedBody: Record<string, unknown> | undefined

  const client = new AnthropicVertex({
    region: 'us-east5',
    authClient: {
      getRequestHeaders: () =>
        new Headers({
          Authorization: 'Bearer vertex-token',
          'x-goog-user-project': 'vertex-project',
        }),
    },
    maxRetries: 0,
    fetch: (async (input, init) => {
      capturedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      capturedHeaders = new Headers(init?.headers)
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return new Response(
        JSON.stringify({
          id: 'msg_vertex',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
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
    }) as typeof fetch,
  })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
  })

  expect(capturedUrl).toBe(
    'https://us-east5-aiplatform.googleapis.com/v1/projects/vertex-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6:rawPredict',
  )
  expect(capturedHeaders?.get('authorization')).toBe('Bearer vertex-token')
  expect(capturedBody?.anthropic_version).toBe('vertex-2023-10-16')
  expect(capturedBody).not.toHaveProperty('model')
  expect(response).toMatchObject({
    id: 'msg_vertex',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
  })
})

test('requires an explicit Vertex auth provider', () => {
  expect(() => new AnthropicVertex({ region: 'us-east5' })).toThrow(
    'A `googleAuth` or `authClient` option is required.',
  )
})

// ─── Regression coverage for the remaining routing/auth branches ──────

type Captured = {
  url?: string
  headers?: Headers
  body?: Record<string, unknown>
}

const MESSAGE_PAYLOAD = {
  id: 'msg_vertex',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
}

function captureRequest(capture: Captured, init: RequestInit | undefined, input: unknown): void {
  capture.url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url
  capture.headers = new Headers(init?.headers)
  if (init?.body) {
    capture.body = JSON.parse(String(init.body)) as Record<string, unknown>
  }
}

function jsonFetch(capture: Captured, payload: unknown): typeof fetch {
  return (async (input, init) => {
    captureRequest(capture, init, input)
    return new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

function sseFetch(capture: Captured): typeof fetch {
  const events = [
    { event: 'message_start', data: { type: 'message_start', message: MESSAGE_PAYLOAD } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]
  const sse = events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')
  return (async (input, init) => {
    captureRequest(capture, init, input)
    return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch
}

function makeClient(
  fetchImpl: typeof fetch,
  extraAuthHeaders?: Record<string, string>,
): AnthropicVertex {
  return new AnthropicVertex({
    region: 'us-east5',
    authClient: {
      getRequestHeaders: () =>
        new Headers({
          Authorization: 'Bearer vertex-token',
          'x-goog-user-project': 'vertex-project',
          ...extraAuthHeaders,
        }),
    },
    maxRetries: 0,
    fetch: fetchImpl,
  })
}

test('routes streaming requests through Vertex streamRawPredict', async () => {
  const capture: Captured = {}
  const client = makeClient(sseFetch(capture))

  const stream = await client.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: true,
  })

  const events: unknown[] = []
  for await (const event of stream) {
    events.push(event)
  }

  expect(capture.url).toBe(
    'https://us-east5-aiplatform.googleapis.com/v1/projects/vertex-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6:streamRawPredict',
  )
  expect(capture.body).not.toHaveProperty('model')
  expect(capture.body?.stream).toBe(true)
  expect(events.length).toBeGreaterThan(0)
})

test('rewrites count_tokens to the Vertex count-tokens:rawPredict endpoint', async () => {
  const capture: Captured = {}
  const client = makeClient(jsonFetch(capture, { input_tokens: 42 }))

  const result = await client.messages.countTokens({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hello' }],
  })

  expect(capture.url).toBe(
    'https://us-east5-aiplatform.googleapis.com/v1/projects/vertex-project/locations/us-east5/publishers/anthropic/models/count-tokens:rawPredict',
  )
  expect(capture.body?.anthropic_version).toBe('vertex-2023-10-16')
  expect(result).toMatchObject({ input_tokens: 42 })
})

test('resolved Vertex auth headers win over caller-supplied Authorization', async () => {
  const capture: Captured = {}
  const client = makeClient(jsonFetch(capture, MESSAGE_PAYLOAD))

  await client.messages.create(
    {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
    },
    { headers: { Authorization: 'Bearer caller-should-not-win' } },
  )

  // The Google auth credential must not be overridable by caller headers.
  expect(capture.headers?.get('authorization')).toBe('Bearer vertex-token')
})

test('rewrites count_tokens?beta=true through the same Vertex endpoint', async () => {
  const client = new AnthropicVertex({
    region: 'us-east5',
    projectId: 'vertex-project',
    authClient: { getRequestHeaders: () => new Headers({ Authorization: 'Bearer t' }) },
    maxRetries: 0,
  })

  const options = {
    method: 'post',
    path: '/v1/messages/count_tokens?beta=true',
    body: { messages: [{ role: 'user', content: 'hi' }] },
  } as Parameters<typeof client.buildRequest>[0]

  await client.buildRequest(options)

  expect(options.path).toBe(
    '/projects/vertex-project/locations/us-east5/publishers/anthropic/models/count-tokens:rawPredict',
  )
  expect((options.body as Record<string, unknown>)?.anthropic_version).toBe('vertex-2023-10-16')
})

test('rejects a message request with a missing/invalid model', async () => {
  const client = new AnthropicVertex({
    region: 'us-east5',
    projectId: 'vertex-project',
    authClient: { getRequestHeaders: () => new Headers() },
    maxRetries: 0,
  })

  await expect(
    client.buildRequest({
      method: 'post',
      path: '/v1/messages',
      body: { messages: [], max_tokens: 1 },
    } as Parameters<typeof client.buildRequest>[0]),
  ).rejects.toThrow('Expected `model` to be a non-empty string')
})

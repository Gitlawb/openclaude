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

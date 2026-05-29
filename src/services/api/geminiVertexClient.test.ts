import { expect, test } from 'bun:test'
import { createGeminiVertexClient, type GeminiVertexStreamEvent } from './geminiVertexClient.js'

function createJsonVertexResponse(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text }] } },
      ],
    }),
    { headers: { 'Content-Type': 'application/json', 'x-request-id': 'vertex-request-123' } },
  )
}

test('Gemini Vertex client uses root aiplatform host for global location', async () => {
  let capturedUrl: string | undefined

  const client = createGeminiVertexClient({
    project: 'project-123',
    location: 'global',
    model: 'gemini-3.5-flash',
    getAccessToken: async () => 'access-token-123',
    fetch: (async (input) => {
      capturedUrl = String(input)
      return createJsonVertexResponse('Bonjour Global Vertex')
    }) as typeof fetch,
  })

  await client.messages.create({
    model: 'gemini-3.5-flash',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Salut' }],
  })

  expect(capturedUrl).toBe(
    'https://aiplatform.googleapis.com/v1/projects/project-123/locations/global/publishers/google/models/gemini-3.5-flash:generateContent',
  )
})

test('Gemini Vertex client sends Anthropic-style messages to Vertex generateContent', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined
  let capturedBody: Record<string, unknown> | undefined

  const client = createGeminiVertexClient({
    project: 'project-123',
    location: 'us-central1',
    model: 'gemini-3.5-flash',
    getAccessToken: async () => 'access-token-123',
    fetch: (async (input, init) => {
      capturedUrl = String(input)
      capturedHeaders = new Headers(init?.headers)
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return createJsonVertexResponse('Bonjour Vertex')
    }) as typeof fetch,
  })

  const response = await client.messages.create({
    model: 'gemini-2.5-pro',
    max_tokens: 321,
    temperature: 0.25,
    messages: [
      { role: 'user', content: 'Salut' },
      { role: 'assistant', content: [{ type: 'text', text: 'Ancienne réponse' }] },
      { role: 'user', content: [{ type: 'text', text: 'Suite' }] },
    ],
  })

  expect(capturedUrl).toBe(
    'https://us-central1-aiplatform.googleapis.com/v1/projects/project-123/locations/us-central1/publishers/google/models/gemini-3.5-flash:generateContent',
  )
  expect(capturedHeaders?.get('authorization')).toBe('Bearer access-token-123')
  expect(capturedHeaders?.get('x-goog-user-project')).toBe('project-123')
  expect(capturedBody).toEqual({
    contents: [
      { role: 'user', parts: [{ text: 'Salut' }] },
      { role: 'model', parts: [{ text: 'Ancienne réponse' }] },
      { role: 'user', parts: [{ text: 'Suite' }] },
    ],
    generationConfig: {
      maxOutputTokens: 321,
      temperature: 0.25,
    },
  })
  expect(response).toMatchObject({
    role: 'assistant',
    model: 'gemini-3.5-flash',
    content: [{ type: 'text', text: 'Bonjour Vertex' }],
  })
})

test('Gemini Vertex client supports Anthropic streaming withResponse contract', async () => {
  const client = createGeminiVertexClient({
    project: 'project-123',
    location: 'us-central1',
    model: 'gemini-3.5-flash',
    getAccessToken: async () => 'access-token-123',
    fetch: (async () => createJsonVertexResponse('Bonjour Vertex')) as unknown as typeof fetch,
  })

  const result = await client.beta.messages.create({
    model: 'gemini-3.5-flash',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Salut' }],
    stream: true,
  }).withResponse()

  const events: GeminiVertexStreamEvent[] = []
  for await (const event of result.data) {
    events.push(event)
  }

  expect(result.request_id).toBe('vertex-request-123')
  expect(result.response).toBeInstanceOf(Response)
  expect(events.map(event => event.type)).toEqual([
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ])
  expect(events[2]).toMatchObject({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Bonjour Vertex' },
  })
})

test('Gemini Vertex client propagates HTTP errors', async () => {
  const client = createGeminiVertexClient({
    project: 'project-123',
    location: 'us-central1',
    model: 'gemini-3.5-flash',
    getAccessToken: async () => 'access-token-123',
    fetch: (async () => new Response('permission denied', { status: 403 })) as NonNullable<import('@anthropic-ai/sdk').ClientOptions['fetch']>,
  })

  await expect(client.messages.create({
    model: 'gemini-3.5-flash',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Salut' }],
  })).rejects.toThrow('Gemini Vertex request failed: 403 permission denied')
})

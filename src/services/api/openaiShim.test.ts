import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createOpenAIShimClient } from './openaiShim.ts'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
}

const originalFetch = globalThis.fetch

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

function makeStreamChunks(chunks: unknown[]): string[] {
  return [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ]
}

beforeEach(() => {
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  process.env.OPENAI_API_KEY = 'test-key'
})

afterEach(() => {
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  globalThis.fetch = originalFetch
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
  }) as FetchType

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
  }) as FetchType

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
  }) as FetchType

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
  }) as FetchType

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
  expect(parameters?.required).toEqual(['priority'])
  expect(properties?.priority?.type).toBe('integer')
  expect(properties?.priority?.enum).toEqual([0, 1, 2, 3])
  expect(properties?.priority).not.toHaveProperty('default')
})

// ---------------------------------------------------------------------------
// Regression tests requested by reviewer on PR #237
// ---------------------------------------------------------------------------

test('streams reasoning_content as thinking blocks then closes before tool_calls', async () => {
  // Simulates DeepSeek R1 pattern: reasoning → tool_call (no text in between)
  globalThis.fetch = (async () => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-r1',
        object: 'chat.completion.chunk',
        model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: { reasoning_content: 'Let me think...' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-r1',
        object: 'chat.completion.chunk',
        model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: { reasoning_content: ' about this.' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-r1',
        object: 'chat.completion.chunk',
        model: 'deepseek-reasoner',
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } }] },
          finish_reason: null,
        }],
      },
      {
        id: 'chatcmpl-r1',
        object: 'chat.completion.chunk',
        model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ])
    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = client.beta.messages.create({
    model: 'deepseek-reasoner',
    system: 'sys',
    messages: [{ role: 'user', content: 'think and act' }],
    max_tokens: 1024,
    stream: true,
  })

  const { data: stream } = await (result as unknown as { withResponse: () => Promise<{ data: AsyncIterable<Record<string, unknown>> }> }).withResponse()

  const events: Array<{ type: string; [k: string]: unknown }> = []
  for await (const event of stream) {
    events.push(event as { type: string })
  }

  const types = events.map(e => e.type)

  // Verify thinking block is opened and closed before tool_use
  expect(types).toContain('content_block_start')

  // Find the thinking start and tool_use start
  const thinkingStart = events.find(
    e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'thinking',
  )
  const toolUseStart = events.find(
    e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'tool_use',
  )

  expect(thinkingStart).toBeDefined()
  expect(toolUseStart).toBeDefined()

  // Thinking block index should be lower than tool_use index
  const thinkingIdx = (thinkingStart as Record<string, number>).index
  const toolIdx = (toolUseStart as Record<string, number>).index
  expect(thinkingIdx).toBeLessThan(toolIdx)

  // Verify thinking block is stopped before tool_use starts
  const thinkingStop = events.find(
    e => e.type === 'content_block_stop' && (e as Record<string, number>).index === thinkingIdx,
  )
  expect(thinkingStop).toBeDefined()
  const thinkingStopPos = events.indexOf(thinkingStop!)
  const toolStartPos = events.indexOf(toolUseStart!)
  expect(thinkingStopPos).toBeLessThan(toolStartPos)

  // Verify thinking deltas contain the reasoning text
  const thinkingDeltas = events.filter(
    e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'thinking_delta',
  )
  expect(thinkingDeltas.length).toBeGreaterThan(0)
  const fullThinking = thinkingDeltas.map(e => (e.delta as Record<string, string>).thinking).join('')
  expect(fullThinking).toContain('Let me think...')
  expect(fullThinking).toContain('about this.')
})

test('forwards tool_result images as image_url content parts', async () => {
  let sentBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
    sentBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-img',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'I see the image.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'sys',
    messages: [
      { role: 'user', content: 'take screenshot' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_ss', name: 'Screenshot', input: {} }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call_ss',
          content: [
            { type: 'text', text: 'Screenshot captured' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
          ],
        }],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = sentBody?.messages as Array<{ role: string; content: unknown }>
  const toolMsg = messages.find(m => m.role === 'tool')
  expect(toolMsg).toBeDefined()

  // Content should be an array with text + image_url parts (not a flat string)
  const content = toolMsg!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
  expect(Array.isArray(content)).toBe(true)

  const textPart = content.find(p => p.type === 'text')
  expect(textPart?.text).toContain('Screenshot captured')

  const imagePart = content.find(p => p.type === 'image_url')
  expect(imagePart).toBeDefined()
  expect(imagePart!.image_url!.url).toContain('data:image/png;base64,')
})

test('sends max_tokens instead of max_completion_tokens for local providers', async () => {
  // Override to local URL (Ollama pattern)
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  let sentBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
    sentBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-local',
        model: 'llama3.1:8b',
        choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'llama3.1:8b',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 512,
    stream: false,
  })

  // Local provider should use max_tokens, not max_completion_tokens
  expect(sentBody?.max_tokens).toBe(512)
  expect(sentBody?.max_completion_tokens).toBeUndefined()

  // Also verify stream_options is NOT sent for local providers
  expect(sentBody?.stream_options).toBeUndefined()
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createSparkShimClient } from './sparkShim.ts'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  SPARK_API_KEY: process.env.SPARK_API_KEY,
  SPARK_BASE_URL: process.env.SPARK_BASE_URL,
  SPARK_MODEL: process.env.SPARK_MODEL,
  CLAUDE_CODE_USE_SPARK: process.env.CLAUDE_CODE_USE_SPARK,
}

const originalFetch = globalThis.fetch

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

type SparkShimClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<unknown>
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
  process.env.SPARK_API_KEY = 'spark-test-password'
  delete process.env.SPARK_BASE_URL
  delete process.env.SPARK_MODEL
  delete process.env.CLAUDE_CODE_USE_SPARK
})

afterEach(() => {
  restoreEnv('SPARK_API_KEY', originalEnv.SPARK_API_KEY)
  restoreEnv('SPARK_BASE_URL', originalEnv.SPARK_BASE_URL)
  restoreEnv('SPARK_MODEL', originalEnv.SPARK_MODEL)
  restoreEnv('CLAUDE_CODE_USE_SPARK', originalEnv.CLAUDE_CODE_USE_SPARK)
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// SSE chunk parsing — happy path
// ---------------------------------------------------------------------------

test('streaming: emits text content events from Spark SSE chunks', async () => {
  globalThis.fetch = (async (_input, init) => {
    const url = typeof _input === 'string' ? _input : _input.url
    expect(url).toBe('https://spark-api-open.xf-yun.com/v1/chat/completions')

    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bearer spark-test-password')

    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('generalv4.0')
    expect(body.stream).toBe(true)

    const chunks = makeStreamChunks([
      {
        id: 'spark-001',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Hello' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'spark-001',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: { content: ' world' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'spark-001',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
      {
        id: 'spark-001',
        model: 'generalv4.0',
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createSparkShimClient({
    defaultHeaders: {},
  }) as SparkShimClient

  const stream = await client.beta.messages.create({
    model: 'generalv4.0',
    system: 'You are a test assistant',
    messages: [{ role: 'user', content: 'Say hi' }],
    max_tokens: 64,
    stream: true,
  }) as AsyncIterable<Record<string, unknown>>

  const events: Array<Record<string, unknown>> = []
  for await (const event of stream) {
    events.push(event)
  }

  const types = events.map(e => e.type)
  expect(types).toContain('message_start')
  expect(types).toContain('content_block_start')
  expect(types).toContain('content_block_stop')
  expect(types).toContain('message_stop')

  const textDeltas = events
    .filter(e => e.type === 'content_block_delta' && (e.delta as any)?.type === 'text_delta')
    .map(e => (e.delta as any).text)
  expect(textDeltas.join('')).toBe('Hello world')

  const usageEvent = events.find(
    e => e.type === 'message_delta' && typeof e.usage === 'object' && e.usage !== null,
  ) as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined
  expect(usageEvent?.usage?.input_tokens).toBe(10)
  expect(usageEvent?.usage?.output_tokens).toBe(5)
})

test('non-streaming: returns structured Anthropic-format response', async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(false)

    return new Response(
      JSON.stringify({
        id: 'spark-002',
        model: 'generalv4.0',
        choices: [
          {
            message: { role: 'assistant', content: 'Hello there' },
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
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  const result = (await client.beta.messages.create({
    model: 'generalv4.0',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
  })) as { id?: string; role?: string; content?: Array<Record<string, unknown>>; stop_reason?: string }

  expect(result.id).toBe('spark-002')
  expect(result.role).toBe('assistant')
  expect(result.stop_reason).toBe('end_turn')
  expect(result.content).toEqual([{ type: 'text', text: 'Hello there' }])
})

// ---------------------------------------------------------------------------
// Tool-call translation
// ---------------------------------------------------------------------------

test('streaming: translates Spark tool_call chunks into Anthropic content_block events', async () => {
  globalThis.fetch = (async () => {
    const chunks = makeStreamChunks([
      {
        id: 'spark-003',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_spark_1',
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
        id: 'spark-003',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
      {
        id: 'spark-003',
        model: 'generalv4.0',
        choices: [],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  const stream = await client.beta.messages.create({
    model: 'generalv4.0',
    system: 'test system',
    messages: [{ role: 'user', content: 'Run ls' }],
    max_tokens: 64,
    stream: true,
  }) as AsyncIterable<Record<string, unknown>>

  const events: Array<Record<string, unknown>> = []
  for await (const event of stream) {
    events.push(event)
  }

  const toolStart = events.find(
    e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined
  expect(toolStart?.content_block?.id).toBe('call_spark_1')
  expect(toolStart?.content_block?.name).toBe('Bash')

  const toolDelta = events.find(
    e => e.type === 'content_block_delta' && (e.delta as any)?.type === 'input_json_delta',
  ) as { delta?: { partial_json?: string } } | undefined
  expect(toolDelta?.delta?.partial_json).toBe('{"command":"ls"}')

  const finishEvent = events.find(
    e => e.type === 'message_delta' && (e.delta as any)?.stop_reason === 'tool_use',
  )
  expect(finishEvent).toBeDefined()
})

test('non-streaming: translates tool_calls response into Anthropic content array', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'spark-004',
        model: 'generalv4.0',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_spark_2',
                  type: 'function',
                  function: {
                    name: 'Read',
                    arguments: '{"file_path":"/tmp/test.txt"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 8,
          total_tokens: 23,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  const result = (await client.beta.messages.create({
    model: 'generalv4.0',
    system: 'test system',
    messages: [{ role: 'user', content: 'Read the file' }],
    tools: [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to file' },
          },
          required: ['file_path'],
        },
      },
    ],
    max_tokens: 64,
    stream: false,
  })) as { content?: Array<Record<string, unknown>>; stop_reason?: string }

  expect(result.stop_reason).toBe('tool_use')
  expect(result.content).toEqual([
    {
      type: 'tool_use',
      id: 'call_spark_2',
      name: 'Read',
      input: { file_path: '/tmp/test.txt' },
    },
  ])

  // Verify tools sent to Spark use "functions" (legacy OpenAI naming)
  expect(requestBody?.functions).toBeDefined()
  expect(requestBody?.tools).toBeUndefined()
})

test('translates Anthropic system prompt array into OpenAI system string', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'spark-005',
        model: 'generalv4.0',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  await client.beta.messages.create({
    model: 'generalv4.0',
    system: [
      { type: 'text', text: 'Line one' },
      { type: 'text', text: 'Line two' },
    ],
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<{ role: string; content: string }> | undefined
  const systemMsg = messages?.find(m => m.role === 'system')
  expect(systemMsg?.content).toBe('Line one\n\nLine two')
})

test('coalesces consecutive user messages into one', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'spark-006',
        model: 'generalv4.0',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  await client.beta.messages.create({
    model: 'generalv4.0',
    messages: [
      { role: 'user', content: 'First message' },
      { role: 'user', content: 'Second message' },
    ],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<{ role: string; content: string }> | undefined
  const userMsgs = messages?.filter(m => m.role === 'user')
  expect(userMsgs?.length).toBe(1)
  expect(userMsgs?.[0]?.content).toContain('First message')
  expect(userMsgs?.[0]?.content).toContain('Second message')
})

// ---------------------------------------------------------------------------
// Malformed-payload / error cases
// ---------------------------------------------------------------------------

test('throws on missing SPARK_API_KEY', async () => {
  delete process.env.SPARK_API_KEY

  globalThis.fetch = (async () => {
    throw new Error('should not reach fetch')
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  await expect(
    client.beta.messages.create({
      model: 'generalv4.0',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow('SPARK_API_KEY')
})

test('handles Spark error code in streaming response', async () => {
  globalThis.fetch = (async () => {
    const chunks = makeStreamChunks([
      {
        id: 'spark-err',
        model: 'generalv4.0',
        code: 10001,
        message: 'Invalid API key format',
        choices: [],
      },
    ])
    return makeSseResponse(chunks)
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  const stream = await client.beta.messages.create({
    model: 'generalv4.0',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: true,
  }) as AsyncIterable<Record<string, unknown>>

  await expect(
    (async () => {
      for await (const _event of stream) {
        // consume stream
      }
    })(),
  ).rejects.toThrow('Invalid API key format')
})

test('handles Spark error code in non-streaming response', async () => {
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        code: 10002,
        message: 'Model not found',
        sid: 'spark-err-001',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  await expect(
    client.beta.messages.create({
      model: 'nonexistent-model',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow('Model not found')
})

test('handles malformed JSON in SSE data line gracefully', async () => {
  globalThis.fetch = (async () => {
    // Mix valid and malformed SSE lines
    const lines = [
      'data: {"id":"spark-010","model":"generalv4.0","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {bad json here\n\n',
      'data: {"id":"spark-010","model":"generalv4.0","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"id":"spark-010","model":"generalv4.0","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ]
    return makeSseResponse(lines)
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  const stream = await client.beta.messages.create({
    model: 'generalv4.0',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: true,
  }) as AsyncIterable<Record<string, unknown>>

  const events: Array<Record<string, unknown>> = []
  for await (const event of stream) {
    events.push(event)
  }

  // Should not crash; should still produce message_start, text, and message_stop
  const types = events.map(e => e.type)
  expect(types).toContain('message_start')
  expect(types).toContain('message_stop')

  const textDeltas = events
    .filter(e => e.type === 'content_block_delta' && (e.delta as any)?.type === 'text_delta')
    .map(e => (e.delta as any).text)
  expect(textDeltas.join('')).toBe('Hi')
})

test('handles empty content in streaming chunks without emitting spurious deltas', async () => {
  globalThis.fetch = (async () => {
    const chunks = makeStreamChunks([
      {
        id: 'spark-011',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'spark-011',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: { content: 'Actual content' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'spark-011',
        model: 'generalv4.0',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
      {
        id: 'spark-011',
        model: 'generalv4.0',
        choices: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      },
    ])
    return makeSseResponse(chunks)
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  const stream = await client.beta.messages.create({
    model: 'generalv4.0',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: true,
  }) as AsyncIterable<Record<string, unknown>>

  const textDeltas: string[] = []
  for await (const event of stream) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe('Actual content')
})

test('throws APIError on HTTP non-ok response', async () => {
  globalThis.fetch = (async () => {
    return new Response('Spark gateway error', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    })
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  await expect(
    client.beta.messages.create({
      model: 'generalv4.0',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 32,
      stream: false,
    }),
  ).rejects.toThrow('502')
})

test('sanitizes tool schema: removes invalid default and filters enum types', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'spark-012',
        model: 'generalv4.0',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createSparkShimClient({}) as SparkShimClient

  await client.beta.messages.create({
    model: 'generalv4.0',
    messages: [{ role: 'user', content: 'test' }],
    tools: [
      {
        name: 'TestTool',
        description: 'A test tool',
        input_schema: {
          type: 'object',
          properties: {
            priority: {
              type: 'integer',
              description: 'Priority level',
              default: true,
              enum: [false, 0, 1, 2, 3],
            },
          },
        },
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  const parameters = (
    requestBody?.functions as Array<{ function?: { parameters?: Record<string, unknown> } }>
  )?.[0]?.function?.parameters
  const props = parameters?.properties as Record<string, { enum?: unknown[] }> | undefined

  expect(parameters?.additionalProperties).toBe(false)
  // default should be stripped
  expect(props?.priority).not.toHaveProperty('default')
  // boolean false should be filtered out of enum, leaving only integers
  expect(props?.priority?.enum).toEqual([0, 1, 2, 3])
})

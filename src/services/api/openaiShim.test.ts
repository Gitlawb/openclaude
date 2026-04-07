import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createOpenAIShimClient } from './openaiShim.ts'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GEMINI_ACCESS_TOKEN: process.env.GEMINI_ACCESS_TOKEN,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
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

function makeSseResponse(lines: string[], extraHeaders?: Record<string, string>): Response {
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
        ...extraHeaders,
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
  delete process.env.OPENAI_MODEL
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_MODEL
  delete process.env.GOOGLE_CLOUD_PROJECT
})

afterEach(() => {
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
  restoreEnv('GOOGLE_API_KEY', originalEnv.GOOGLE_API_KEY)
  restoreEnv('GEMINI_ACCESS_TOKEN', originalEnv.GEMINI_ACCESS_TOKEN)
  restoreEnv('GEMINI_AUTH_MODE', originalEnv.GEMINI_AUTH_MODE)
  restoreEnv('GEMINI_BASE_URL', originalEnv.GEMINI_BASE_URL)
  restoreEnv('GEMINI_MODEL', originalEnv.GEMINI_MODEL)
  restoreEnv('GOOGLE_CLOUD_PROJECT', originalEnv.GOOGLE_CLOUD_PROJECT)
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
  }) as FetchType

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
  ) as { content?: string } | undefined

  expect(toolMessage?.content).toContain('[image:image/png]')
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
  }) as FetchType

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
  expect(capturedAuthorization).toBe('Bearer gemini-access-token')
  expect(capturedProject).toBe('gemini-project')
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
  }) as FetchType

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

  // Coalescing is still active: consecutive user messages are merged to maintain
  // strict user↔assistant alternation required by OpenAI/vLLM/Ollama
  expect(sentMessages?.length).toBe(2) // system + 1 coalesced user message
  expect(sentMessages?.[0]?.role).toBe('system')
  expect(sentMessages?.[1]?.role).toBe('user')
  expect(sentMessages?.[1]?.content).toContain('first message')
  expect(sentMessages?.[1]?.content).toContain('second message')
})

test('coalesces consecutive assistant messages preserving tool_calls (issue #202)', async () => {
  let sentMessages: Array<{ role: string; content: unknown; tool_calls?: unknown[] }> | undefined

  globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
    sentMessages = JSON.parse(String(init?.body)).messages
    return makeNonStreamResponse()
  }) as FetchType

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

  // Coalescing is still active: consecutive assistant messages are merged
  const assistantMsgs = sentMessages?.filter(m => m.role === 'assistant')
  expect(assistantMsgs?.length).toBe(1) // two assistant turns coalesced into one
})

test('prefers native token counts over standard token counts in streaming usage', async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 30,
          native_tokens_prompt: 50,
          native_tokens_completion: 10,
          completion_tokens_details: { reasoning_tokens: 5 },
        },
      },
    ])
    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({ model: 'fake-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) events.push(event)

  const usageEvent = events.find(
    e => e.type === 'message_delta' && typeof e.usage === 'object' && e.usage !== null,
  ) as { usage?: Record<string, unknown> } | undefined

  // native_tokens_prompt (50) should be preferred over prompt_tokens (100)
  expect(usageEvent?.usage?.input_tokens).toBe(50)
  // native_tokens_completion (10) preferred over completion_tokens (30)
  expect(usageEvent?.usage?.output_tokens).toBe(10)
})

test('prefers native token counts over standard token counts in non-streaming response', async () => {
  globalThis.fetch = (async (_input, init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'fake-model',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 30,
          native_tokens_prompt: 50,
          native_tokens_completion: 10,
          completion_tokens_details: { reasoning_tokens: 5 },
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages.create({
    model: 'fake-model',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  })

  expect((result as Record<string, unknown>).usage).toMatchObject({
    input_tokens: 100,
    output_tokens: 30,
  })
})

test('calls OpenRouter generation API when x-generation-id header is present in streaming response', async () => {
  const chunks = makeStreamChunks([
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'anthropic/claude-sonnet-4-5-20250514',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'anthropic/claude-sonnet-4-5-20250514',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
    // Empty choices, no usage in the stream — this is the scenario
    // where OpenRouter doesn't include usage in the SSE body.
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'anthropic/claude-sonnet-4-5-20250514',
      choices: [],
    },
  ])

  let generationApiCalled = false
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/v1/generation')) {
      generationApiCalled = true
      expect((init as RequestInit)?.headers).toMatchObject({
        'Authorization': 'Bearer or-test-key',
      })
      return new Response(
        JSON.stringify({
          data: {
            tokens_prompt: 100,
            tokens_completion: 50,
            native_tokens_prompt: 90,
            native_tokens_completion: 45,
            native_tokens_reasoning: 10,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }
    return makeSseResponse(chunks, { 'x-generation-id': 'gen-abc-123' })
  }) as FetchType

  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'or-test-key'

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({ model: 'anthropic/claude-sonnet-4-5-20250514', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  expect(generationApiCalled).toBe(true)

  // Wait for the follow-up message_delta to be yielded after stream completes
  await new Promise(r => setTimeout(r, 100))

  const allDeltaEvents = events.filter(e => e.type === 'message_delta')

  // Verify that at least one streamed message_delta contains the injected
  // usage values returned by the generation API.
  // Note: The implementation prefers standard token counts over native tokens.
  const hasCorrectUsage = allDeltaEvents.some(e => {
    const usage = e.usage as Record<string, unknown> | undefined
    return usage?.input_tokens === 100 && usage?.output_tokens === 60
  })

  expect(hasCorrectUsage).toBe(true)
})

test('skips generation stats fetch when x-generation-id header is absent', async () => {
  const chunks = makeStreamChunks([
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ])

  let generationApiCalled = false
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/v1/generation')) {
      generationApiCalled = true
    }
    return makeSseResponse(chunks)
    // no x-generation-id header set
  }) as FetchType

  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'or-test-key'

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({ model: 'fake-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) events.push(event)

  // Give time for any async fetch that shouldn't happen
  await new Promise(r => setTimeout(r, 50))

  expect(generationApiCalled).toBe(false)
})

test('times out generation stats fetch after 5 seconds', async () => {
  const chunks = makeStreamChunks([
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [],
    },
  ])

  let generationApiCallStartTime: number | undefined
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/v1/generation')) {
      generationApiCallStartTime = Date.now()
      // Delay longer than 5 second timeout
      await new Promise(r => setTimeout(r, 6000))
      return new Response(
        JSON.stringify({
          data: {
            tokens_prompt: 100,
            tokens_completion: 50,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }
    return makeSseResponse(chunks, { 'x-generation-id': 'gen-abc-123' })
  }) as FetchType

  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'or-test-key'

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({ model: 'fake-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  const startTime = Date.now()
  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  // Wait for potential timeout
  await new Promise(r => setTimeout(r, 100))

  const elapsed = Date.now() - startTime

  // Should complete quickly (< 1 second) even though generation API takes 6 seconds,
  // because the 5-second timeout should abort the fetch
  expect(elapsed).toBeLessThan(2000)
})

test('handles generation API errors gracefully', async () => {
  const chunks = makeStreamChunks([
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'fake-model',
      choices: [],
    },
  ])

  let generationApiCalled = false
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/v1/generation')) {
      generationApiCalled = true
      // Return an error response
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return makeSseResponse(chunks, { 'x-generation-id': 'gen-abc-123' })
  }) as FetchType

  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'or-test-key'

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({ model: 'fake-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  // Should not throw - stream completes normally even when generation API fails
  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  expect(generationApiCalled).toBe(true)
  expect(events.length).toBeGreaterThan(0)
})

test('does not send API key to invalid or non-HTTPS origins', async () => {
  let generationApiCalled = false
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/v1/generation')) {
      generationApiCalled = true
    }
    // Return a mock SSE response
    return makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
      },
    ]), { 'x-generation-id': 'gen-abc-123' })
  }) as FetchType

  const client = createOpenAIShimClient({
    providerOverride: {
      model: 'openrouter-model',
      baseURL: 'http://insecure-http.example.com/v1', // HTTP (not HTTPS)
      apiKey: 'super-secret-key',
    },
  }) as OpenAIShimClient

  const result = await client.beta.messages
    .create({ model: 'openrouter-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  await new Promise(r => setTimeout(r, 50))

  // Should NOT call generation API for non-HTTPS origins
  expect(generationApiCalled).toBe(false)

  globalThis.fetch = originalFetch
})

test('does not send API key to URLs with embedded credentials', async () => {
  let generationApiCalled = false
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/v1/generation')) {
      generationApiCalled = true
    }
    return makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
      },
    ]), { 'x-generation-id': 'gen-abc-123' })
  }) as FetchType

  const client = createOpenAIShimClient({
    providerOverride: {
      model: 'openrouter-model',
      baseURL: 'https://user:pass@evil.com/v1', // Embedded credentials
      apiKey: 'super-secret-key',
    },
  }) as OpenAIShimClient

  const result = await client.beta.messages
    .create({ model: 'openrouter-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  await new Promise(r => setTimeout(r, 50))

  // Should NOT call generation API for URLs with embedded credentials
  expect(generationApiCalled).toBe(false)

  globalThis.fetch = originalFetch
})

test('does not send API key to IP address origins', async () => {
  let generationApiCalled = false
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/v1/generation')) {
      generationApiCalled = true
    }
    return makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
      },
    ]), { 'x-generation-id': 'gen-abc-123' })
  }) as FetchType

  const client = createOpenAIShimClient({
    providerOverride: {
      model: 'openrouter-model',
      baseURL: 'https://192.168.1.1/v1', // IP address
      apiKey: 'super-secret-key',
    },
  }) as OpenAIShimClient

  const result = await client.beta.messages
    .create({ model: 'openrouter-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  await new Promise(r => setTimeout(r, 50))

  // Should NOT call generation API for IP address origins
  expect(generationApiCalled).toBe(false)

  globalThis.fetch = originalFetch
})

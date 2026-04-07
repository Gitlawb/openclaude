import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createOpenAIShimClient } from './openaiShim.ts'
import { Type } from 'ajv/dist/compile/util.js'
import model from 'src/commands/model/index.js'
import { stream } from 'undici'
import { error } from 'node:console'

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

test('does not infer Gemini mode from OPENAI_BASE_URL path substrings', async () => {
  let capturedAuthorization: string | null = null

  process.env.OPENAI_BASE_URL =
    'https://evil.example/generativelanguage.googleapis.com/v1beta/openai'
  delete process.env.OPENAI_API_KEY
  process.env.GEMINI_API_KEY = 'gemini-secret'

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'fake-model',
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
    model: 'fake-model',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
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

test('normalizes plain string Bash tool arguments from OpenAI-compatible responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: 'pwd',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
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

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    stop_reason?: string
    content?: Array<Record<string, unknown>>
  }

  expect(message.stop_reason).toBe('tool_use')
  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: { command: 'pwd' },
    },
  ])
})

test('normalizes Bash tool arguments that are valid JSON strings', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '"pwd"',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
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

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: { command: 'pwd' },
    },
  ])
})

test.each([
  ['false', false],
  ['null', null],
  ['[]', []],
])(
  'preserves malformed Bash JSON literals as parsed values in non-streaming responses: %s',
  async (argumentsValue, expectedInput) => {
    globalThis.fetch = (async (_input, _init) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          model: 'google/gemini-3.1-pro-preview',
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'function-call-1',
                    type: 'function',
                    function: {
                      name: 'Bash',
                      arguments: argumentsValue,
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
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

    const message = await client.beta.messages.create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: false,
    }) as {
      content?: Array<Record<string, unknown>>
    }

    expect(message.content).toEqual([
      {
        type: 'tool_use',
        id: 'function-call-1',
        name: 'Bash',
        input: expectedInput,
      },
    ])
  },
)

test('keeps terminal empty Bash tool arguments invalid in non-streaming responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
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

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: {},
    },
  ])
})

test('normalizes plain string Bash tool arguments in streaming responses', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: 'pwd',
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

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"pwd"}')
})

test('normalizes plain string Bash tool arguments when streaming starts with an empty chunk', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: '',
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
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: 'function',
                  function: {
                    arguments: 'pwd',
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

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"pwd"}')
})

test('normalizes plain string Bash tool arguments when streaming starts with whitespace', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: ' ',
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
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: 'function',
                  function: {
                    arguments: 'pwd',
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

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":" pwd"}')
})

test('keeps terminal whitespace-only Bash arguments invalid in streaming responses', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: ' ',
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

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{}')
})

test('normalizes streaming Bash arguments that begin with bracket syntax', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: '[ -f package.json ] && pwd',
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

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"[ -f package.json ] && pwd"}')
})

test('normalizes streaming Bash arguments when the first chunk is only an opening brace', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: '{',
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
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: 'function',
                  function: {
                    arguments: ' pwd; }',
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

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"{ pwd; }"}')
})

test('repairs truncated structured Bash JSON in streaming responses', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: '{"command":"pwd"',
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

  const normalizedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(normalizedInput).toBe('{"command":"pwd"}')
})

test('does not normalize incomplete streamed Bash commands when finish_reason is length', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: 'rg --fi',
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
            finish_reason: 'length',
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

  const streamedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(streamedInput).toBe('rg --fi')
})

test('repairs truncated JSON objects even without command field', async () => {
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
                  function: {
                    name: 'Bash',
                    arguments: '{"cwd":"/tmp"',
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

  const streamedInput = events
    .filter(
      event =>
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null &&
        (event.delta as Record<string, unknown>).type === 'input_json_delta',
    )
    .map(event => (event.delta as Record<string, unknown>).partial_json)
    .join('')

  expect(streamedInput).toBe('{"cwd":"/tmp"}')
})

test('preserves raw input for unknown plain string tool arguments', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'UnknownTool',
                    arguments: 'pwd',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
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

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use tool' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'UnknownTool',
      input: {},
    },
  ])
})

test('preserves parsed string input for unknown JSON string tool arguments', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'UnknownTool',
                    arguments: '"pwd"',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
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

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use tool' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'UnknownTool',
      input: 'pwd',
    },
  ])
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

  expect(sentMessages?.length).toBe(2) // system + 1 merged user
  expect(sentMessages?.[0]?.role).toBe('system')
  expect(sentMessages?.[1]?.role).toBe('user')
  const userContent = sentMessages?.[1]?.content as string
  expect(userContent).toContain('first message')
  expect(userContent).toContain('second message')
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

  // system + user + merged assistant + tool
  const assistantMsgs = sentMessages?.filter(m => m.role === 'assistant')
  expect(assistantMsgs?.length).toBe(1) // two assistant turns merged into one
  expect(assistantMsgs?.[0]?.tool_calls?.length).toBeGreaterThan(0)
})

test('non-streaming: reasoning_content emitted as thinking block, used as text when content is null', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'Let me think about this step by step.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
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

  const result = (await client.beta.messages.create({
    model: 'glm-5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  expect(result.content).toEqual([
    { type: 'thinking', thinking: 'Let me think about this step by step.' },
    { type: 'text', text: 'Let me think about this step by step.' },
  ])
})

test('non-streaming: empty string content does not fall through to reasoning_content as text', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              reasoning_content: 'Chain of thought here.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
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

  const result = (await client.beta.messages.create({
    model: 'glm-5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  // reasoning_content should be a thinking block, and also used as text
  // since content is empty string (treated as absent)
  expect(result.content).toEqual([
    { type: 'thinking', thinking: 'Chain of thought here.' },
    { type: 'text', text: 'Chain of thought here.' },
  ])
})

test('non-streaming: real content takes precedence over reasoning_content', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'glm-5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'I need to calculate this.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
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

  const result = (await client.beta.messages.create({
    model: 'glm-5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  expect(result.content).toEqual([
    { type: 'thinking', thinking: 'I need to calculate this.' },
    { type: 'text', text: 'The answer is 42.' },
  ])
})

test('streaming: thinking block closed before tool call', async () => {
  globalThis.fetch = (async (_input, _init) => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', reasoning_content: 'Thinking...' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
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
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'glm-5',
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
      model: 'glm-5',
      system: 'test system',
      messages: [{ role: 'user', content: 'Run ls' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const types = events.map(e => e.type)

  // Verify thinking block is started, then closed, then tool call starts
  const thinkingStartIdx = types.indexOf('content_block_start')
  const firstStopIdx = types.indexOf('content_block_stop')
  const toolStartIdx = types.indexOf(
    'content_block_start',
    thinkingStartIdx + 1,
  )

  expect(thinkingStartIdx).toBeGreaterThanOrEqual(0)
  expect(firstStopIdx).toBeGreaterThan(thinkingStartIdx)
  expect(toolStartIdx).toBeGreaterThan(firstStopIdx)

  // Verify thinking block start content
  const thinkingStart = events[thinkingStartIdx] as {
    content_block?: Record<string, unknown>
  }
  expect(thinkingStart?.content_block?.type).toBe('thinking')
})

test('strips credentials and query params from URL in fetch network error message', async () => {
  process.env.OPENAI_BASE_URL = 'https://user:password@internal.example.test/v1?token=abc123'
  process.env.OPENAI_API_KEY = 'test-key'
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as FetchType
  const client = createOpenAIShimClient({}) as OpenAIShimClient

  let caught: unknown
  try {
    await client.beta.messages.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    })
  } catch (e) {
    caught = e
  }

  const msg = (caught as Error).message
  expect(msg).toContain('internal.example.test')
  expect(msg).toContain('fetch failed')
  expect(msg).not.toContain('password')
  expect(msg).not.toContain('user:')
  expect(msg).not.toContain('token=abc123')
})

test('preserves AbortError on user cancellation', async () => {
  globalThis.fetch = (async () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    throw err
  }) as unknown as FetchType
  const client = createOpenAIShimClient({}) as OpenAIShimClient

  let caught: unknown
  try {
    await client.beta.messages.create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    })
  } catch (e) {
    caught = e
  }

  expect((caught as Error).name).toBe('AbortError')
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { registerGateway } from '../../integrations/index.ts'
import { createOpenAIShimClient } from './openaiShim.ts'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GEMINI_ACCESS_TOKEN: process.env.GEMINI_ACCESS_TOKEN,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
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
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_MODEL
  delete process.env.GOOGLE_CLOUD_PROJECT
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
  delete process.env.NVIDIA_API_KEY
  delete process.env.NVIDIA_NIM
  delete process.env.OPENROUTER_API_KEY
  delete process.env.DEEPSEEK_API_KEY
})

afterEach(() => {
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
  restoreEnv('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN)
  restoreEnv('GH_TOKEN', originalEnv.GH_TOKEN)
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
  restoreEnv('GOOGLE_API_KEY', originalEnv.GOOGLE_API_KEY)
  restoreEnv('GEMINI_ACCESS_TOKEN', originalEnv.GEMINI_ACCESS_TOKEN)
  restoreEnv('GEMINI_AUTH_MODE', originalEnv.GEMINI_AUTH_MODE)
  restoreEnv('GEMINI_BASE_URL', originalEnv.GEMINI_BASE_URL)
  restoreEnv('GEMINI_MODEL', originalEnv.GEMINI_MODEL)
  restoreEnv('GOOGLE_CLOUD_PROJECT', originalEnv.GOOGLE_CLOUD_PROJECT)
  restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
  restoreEnv('NVIDIA_API_KEY', originalEnv.NVIDIA_API_KEY)
  restoreEnv('NVIDIA_NIM', originalEnv.NVIDIA_NIM)
  restoreEnv('OPENROUTER_API_KEY', originalEnv.OPENROUTER_API_KEY)
  restoreEnv('DEEPSEEK_API_KEY', originalEnv.DEEPSEEK_API_KEY)
  globalThis.fetch = originalFetch
})

test('strips canonical Anthropic headers from direct shim defaultHeaders', async () => {
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

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
          prompt_tokens: 8,
          completion_tokens: 3,
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

  const client = createOpenAIShimClient({
    defaultHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-anthropic-additional-protection': 'true',
      'x-claude-remote-session-id': 'remote-123',
      'x-app': 'cli',
      'x-client-app': 'sdk',
      'x-safe-header': 'keep-me',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('anthropic-beta')).toBeNull()
  expect(capturedHeaders?.get('x-anthropic-additional-protection')).toBeNull()
  expect(capturedHeaders?.get('x-claude-remote-session-id')).toBeNull()
  expect(capturedHeaders?.get('x-app')).toBeNull()
  expect(capturedHeaders?.get('x-client-app')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
})

test('strips canonical Anthropic headers from per-request shim headers too', async () => {
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

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
          prompt_tokens: 8,
          completion_tokens: 3,
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

  await client.beta.messages.create(
    {
      model: 'gpt-4o',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    },
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-safe-header': 'keep-me',
      },
    },
  )

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('anthropic-beta')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
})

test('applies descriptor static headers before client and request headers', async () => {
  let capturedHeaders: Headers | undefined

  registerGateway({
    id: 'shim-header-test',
    label: 'Shim Header Test',
    category: 'hosted',
    defaultBaseUrl: 'https://shim-header-test.example/v1',
    defaultModel: 'shim-test-model',
    setup: {
      requiresAuth: true,
      authMode: 'api-key',
      credentialEnvVars: ['OPENAI_API_KEY'],
    },
    transportConfig: {
      kind: 'openai-compatible',
      openaiShim: {
        headers: {
          'x-static-header': 'from-descriptor',
          'x-override-header': 'from-descriptor',
        },
      },
    },
  })

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://shim-header-test.example/v1'
  process.env.OPENAI_MODEL = 'shim-test-model'

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'shim-test-model',
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
          prompt_tokens: 8,
          completion_tokens: 3,
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

  const client = createOpenAIShimClient({
    defaultHeaders: {
      'x-override-header': 'from-client',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'shim-test-model',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    },
    {
      headers: {
        'x-override-header': 'from-request',
      },
    },
  )

  expect(capturedHeaders?.get('x-static-header')).toBe('from-descriptor')
  expect(capturedHeaders?.get('x-override-header')).toBe('from-request')
})

test('strips Anthropic-specific headers on GitHub Codex transport requests', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_API_KEY = 'github-test-key'
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'github:gpt-5-codex',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    },
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-anthropic-additional-protection': 'true',
        'x-safe-header': 'keep-me',
      },
    },
  )

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('anthropic-beta')).toBeNull()
  expect(capturedHeaders?.get('x-anthropic-additional-protection')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer github-test-key')
  expect(capturedHeaders?.get('editor-plugin-version')).toBe('copilot-chat/0.26.7')
})

test('strips Anthropic-specific headers on GitHub Codex transport with providerOverride API key', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_API_KEY = 'env-should-not-win'
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    })
  }) as FetchType

  const client = createOpenAIShimClient({
    providerOverride: {
      model: 'github:gpt-5-codex',
      baseURL: 'https://api.githubcopilot.com',
      apiKey: 'provider-override-key',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'ignored',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    },
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-claude-remote-session-id': 'remote-123',
        'x-safe-header': 'keep-me',
      },
    },
  )

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('x-claude-remote-session-id')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer provider-override-key')
  expect(capturedHeaders?.get('editor-plugin-version')).toBe('copilot-chat/0.26.7')
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

test('uses max_tokens instead of max_completion_tokens for local providers', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.max_tokens).toBe(64)
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.stream_options).toBeUndefined()

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'llama3.1:8b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
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
    model: 'llama3.1:8b',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })
})

test('keeps max_completion_tokens for non-local non-github providers', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'

  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.max_completion_tokens).toBe(64)
    expect(body.max_tokens).toBeUndefined()

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
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
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })
})

test('uses route-specific credential env vars for descriptor-backed openai-compatible routes', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENROUTER_API_KEY = 'or-route-key'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'openai/gpt-5-mini',
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
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
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
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('authorization')).toBe('Bearer or-route-key')
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

test('preserves Grep tool pattern field in OpenAI-compatible schemas', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-grep-schema',
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
    messages: [{ role: 'user', content: 'Use Grep' }],
    tools: [
      {
        name: 'Grep',
        description: 'Search file contents',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            path: { type: 'string' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const tools = requestBody?.tools as Array<Record<string, unknown>> | undefined
  const grepTool = tools?.find(tool => (tool.function as Record<string, unknown>)?.name === 'Grep') as
    | { function?: { parameters?: { properties?: Record<string, unknown>; required?: string[] } } }
    | undefined

  expect(Object.keys(grepTool?.function?.parameters?.properties ?? {})).toContain('pattern')
  expect(grepTool?.function?.parameters?.required).toContain('pattern')
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
  ) as {
    content?: Array<{
      type: string
      text?: string
      image_url?: { url: string }
    }> | string
  } | undefined

  expect(Array.isArray(toolMessage?.content)).toBe(true)
  const parts = toolMessage?.content as Array<{
    type: string
    text?: string
    image_url?: { url: string }
  }>
  const imagePart = parts.find(part => part.type === 'image_url')
  expect(imagePart?.image_url?.url).toBe('data:image/png;base64,ZmFrZQ==')
})

test('preserves mixed text and image tool results as multipart content', async () => {
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
    model: 'gpt-4o',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Read this screenshot' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_image_2',
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
            tool_use_id: 'call_image_2',
            content: [
              { type: 'text', text: 'Screenshot captured' },
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
  ) as {
    content?: Array<{
      type: string
      text?: string
      image_url?: { url: string }
    }>
  } | undefined

  expect(Array.isArray(toolMessage?.content)).toBe(true)
  const parts = toolMessage?.content ?? []
  expect(parts[0]).toEqual({ type: 'text', text: 'Screenshot captured' })
  expect(parts[1]).toEqual({
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
  })
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

test('uses NVIDIA_API_KEY for NVIDIA NIM requests without OPENAI_API_KEY', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-nvidia',
        model: 'nvidia/llama-3.1-nemotron-70b-instruct',
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
    model: 'nvidia/llama-3.1-nemotron-70b-instruct',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedAuthorization).toBe('Bearer nvidia-live-key')
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
  // No required[] in the original schema → none added (optional properties must not be forced required)
  expect(parameters?.required).toEqual([])
  expect(properties?.priority?.type).toBe('integer')
  expect(properties?.priority?.enum).toEqual([0, 1, 2, 3])
  expect(properties?.priority).not.toHaveProperty('default')
})

test('optional tool properties are not added to required[] — fixes Groq/Azure 400 tool_use_failed', async () => {
  // Regression test for: all optional properties being sent as required in strict mode,
  // causing providers like Groq to reject valid tool calls where the model omits optional args.
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-4',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'read a file' }],
    tools: [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Absolute path to file' },
            offset: { type: 'number', description: 'Line to start from' },
            limit: { type: 'number', description: 'Max lines to read' },
            pages: { type: 'string', description: 'Page range for PDFs' },
          },
          required: ['file_path'],
        },
      },
    ],
    max_tokens: 16,
    stream: false,
  })

  const parameters = (
    requestBody?.tools as Array<{ function?: { parameters?: Record<string, unknown> } }>
  )?.[0]?.function?.parameters

  expect(parameters?.required).toEqual(['file_path'])

  const required = parameters?.required as string[] | undefined
  expect(required).not.toContain('offset')
  expect(required).not.toContain('limit')
  expect(required).not.toContain('pages')
  expect(parameters?.additionalProperties).toBe(false)
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

  expect(sentMessages?.length).toBe(2)
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

  const assistantMsgs = sentMessages?.filter(m => m.role === 'assistant')
  expect(assistantMsgs?.length).toBe(1)
  expect(assistantMsgs?.[0]?.tool_calls?.length).toBeGreaterThan(0)
})

test('non-streaming: reasoning_content emitted as thinking block only when content is null', async () => {
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

  expect(result.content).toEqual([
    { type: 'thinking', thinking: 'Chain of thought here.' },
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

test('non-streaming: strips <think> tag block from assistant content', async () => {
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                '<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?',
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
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = (await client.beta.messages.create({
    model: 'gpt-5-mini',
    system: 'test system',
    messages: [{ role: 'user', content: 'hey' }],
    max_tokens: 64,
    stream: false,
  })) as { content: Array<Record<string, unknown>> }

  expect(result.content).toEqual([
    { type: 'text', text: 'Hey! How can I help you today?' },
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

  const thinkingStartIdx = types.indexOf('content_block_start')
  const firstStopIdx = types.indexOf('content_block_stop')
  const toolStartIdx = types.indexOf(
    'content_block_start',
    thinkingStartIdx + 1,
  )

  expect(thinkingStartIdx).toBeGreaterThanOrEqual(0)
  expect(firstStopIdx).toBeGreaterThan(thinkingStartIdx)
  expect(toolStartIdx).toBeGreaterThan(firstStopIdx)

  const thinkingStart = events[thinkingStartIdx] as {
    content_block?: Record<string, unknown>
  }
  expect(thinkingStart?.content_block?.type).toBe('thinking')
})

test('streaming: strips <think> tag block from assistant content deltas', async () => {
  globalThis.fetch = (async () => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content:
                '<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'gpt-5-mini',
      system: 'test system',
      messages: [{ role: 'user', content: 'hey' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe('Hey! How can I help you today?')
})

test('streaming: strips <think> tag split across multiple content chunks', async () => {
  globalThis.fetch = (async () => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '<think>user wants a greeting,',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              content: ' respond briefly</th',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              content: 'ink>Hey! How can I help you today?',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const result = await client.beta.messages
    .create({
      model: 'gpt-5-mini',
      system: 'test system',
      messages: [{ role: 'user', content: 'hey' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe('Hey! How can I help you today?')
})

test('streaming: preserves prose without tags (no phrase-based false positive)', async () => {
  // Regression: older phrase-based sanitizer would strip "I should..." prose.
  // The tag-based approach leaves legitimate assistant output alone.
  globalThis.fetch = (async () => {
    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content:
                'I should note that the user role requires a briefly concise friendly response format.',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'gpt-5-mini',
      system: 'test system',
      messages: [{ role: 'user', content: 'hey' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = (event as { delta?: { type?: string; text?: string } }).delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(textDeltas.join('')).toBe(
    'I should note that the user role requires a briefly concise friendly response format.',
  )
})

test('classifies localhost transport failures with actionable category marker', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const transportError = Object.assign(new TypeError('fetch failed'), {
    code: 'ECONNREFUSED',
  })

  globalThis.fetch = (async () => {
    throw transportError
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow('openai_category=connection_refused')

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow('local server is running')
})

test('propagates AbortError without wrapping it as transport failure', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const abortError = new DOMException('The operation was aborted.', 'AbortError')
  globalThis.fetch = (async () => {
    throw abortError
  }) as FetchType

  const controller = new AbortController()
  controller.abort()

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create(
      {
        model: 'qwen2.5-coder:7b',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        stream: false,
      },
      { signal: controller.signal },
    ),
  ).rejects.toBe(abortError)
})

test('classifies chat-completions endpoint 404 failures with endpoint_not_found marker', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434'

  globalThis.fetch = (async () =>
    new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
      },
    })) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow('openai_category=endpoint_not_found')
})
test('self-heals localhost resolution failures by retrying local loopback base URL', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const requestUrls: string[] = []
  globalThis.fetch = (async (input, _init) => {
    const url = typeof input === 'string' ? input : input.url
    requestUrls.push(url)

    if (url.includes('localhost')) {
      const error = Object.assign(new TypeError('fetch failed'), {
        code: 'ENOTFOUND',
      })
      throw error
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'qwen2.5-coder:7b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello from loopback',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).resolves.toBeDefined()

  expect(requestUrls[0]).toBe('http://localhost:11434/v1/chat/completions')
  expect(requestUrls).toContain('http://127.0.0.1:11434/v1/chat/completions')
})

test('self-heals local endpoint_not_found by retrying with /v1 base URL', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434'

  const requestUrls: string[] = []
  globalThis.fetch = (async (input, _init) => {
    const url = typeof input === 'string' ? input : input.url
    requestUrls.push(url)

    if (url === 'http://localhost:11434/chat/completions') {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'qwen2.5-coder:7b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello from /v1',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).resolves.toBeDefined()

  expect(requestUrls).toEqual([
    'http://localhost:11434/chat/completions',
    'http://localhost:11434/v1/chat/completions',
  ])
})

test('self-heals tool-call incompatibility by retrying local Ollama requests without tools', async () => {
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'

  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    requestBodies.push(requestBody)

    if (requestBodies.length === 1) {
      return new Response('tool_calls are not supported', {
        status: 400,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'qwen2.5-coder:7b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'fallback without tools',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
            },
            required: ['filePath'],
          },
        },
      ],
      max_tokens: 64,
      stream: false,
    }),
  ).resolves.toBeDefined()

  expect(requestBodies).toHaveLength(2)
  expect(Array.isArray(requestBodies[0]?.tools)).toBe(true)
  expect(requestBodies[0]?.tool_choice).toBeUndefined()
  expect(
    requestBodies[1]?.tools === undefined ||
      (Array.isArray(requestBodies[1]?.tools) && requestBodies[1]?.tools.length === 0),
  ).toBe(true)
  expect(requestBodies[1]?.tool_choice).toBeUndefined()
})

test('preserves valid tool_result and drops orphan tool_result', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'mistral-large-latest',
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
    model: 'mistral-large-latest',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Search and then I will interrupt' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'valid_call_1',
            name: 'Search',
            input: { query: 'openclaude' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'valid_call_1',
            content: 'Found it!',
          },
          {
            type: 'tool_result',
            tool_use_id: 'orphan_call_2',
            content: 'Interrupted result',
          },
          {
            role: 'user',
            content: 'What happened?',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>

  // Should have: system, user, assistant (tool_use), tool (valid_call_1), user
  // Should NOT have: tool (orphan_call_2)

  const toolMessages = messages.filter(m => m.role === 'tool')
  expect(toolMessages.length).toBe(1)
  expect(toolMessages[0].tool_call_id).toBe('valid_call_1')

  const orphanMessage = toolMessages.find(m => m.tool_call_id === 'orphan_call_2')
  expect(orphanMessage).toBeUndefined()
  
  // Actually, the semantic message IS injected here because the user block with orphan 
  // tool result is converted to:
  // 1. Tool result (valid_call_1) -> role 'tool'
  // 2. User content ("What happened?") -> role 'user'
  // This triggers the tool -> assistant injection.
  const assistantMessages = messages.filter(m => m.role === 'assistant')
  expect(assistantMessages.some(m => m.content === '[Tool execution interrupted by user]')).toBe(true)
})

test('drops empty assistant message when only thinking block was present and stripped', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 123456789,
      model: 'mistral-large-latest',
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mistral-large-latest',
    messages: [
      { role: 'user', content: 'Initial' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'I am thinking...', signature: 'sig' }] },
      { role: 'user', content: 'Interrupting query' },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  // The assistant msg is dropped because thinking is stripped.
  // The two user messages are coalesced.
  expect(messages.length).toBe(1)
  expect(messages[0].role).toBe('user')
  expect(String(messages[0].content)).toContain('Initial')
  expect(String(messages[0].content)).toContain('Interrupting query')
})

test('injects semantic assistant message when tool result is followed by user message', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({
      id: 'chatcmpl-2',
      object: 'chat.completion',
      created: 123456789,
      model: 'mistral-large-latest',
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { headers: { 'Content-Type': 'application/json' } })
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mistral-large-latest',
    messages: [
      { 
        role: 'assistant', 
        content: [{ type: 'tool_use', id: 'call_1', name: 'search', input: {} }] 
      },
      { 
        role: 'user', 
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'Result' }
        ] 
      },
      { role: 'user', content: 'Next user query' },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  // Roles should be: assistant (tool_calls) -> tool -> assistant (semantic) -> user
  const roles = messages.map(m => m.role)
  expect(roles).toEqual(['assistant', 'tool', 'assistant', 'user'])
  
  const semanticMsg = messages[2]
  expect(semanticMsg.role).toBe('assistant')
  expect(semanticMsg.content).toBe('[Tool execution interrupted by user]')
})

test('Moonshot: uses max_tokens (not max_completion_tokens) and strips store', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Moonshot: echoes reasoning_content on assistant tool-call messages', async () => {
  // Regression for: "API Error: 400 {"error":{"message":"thinking is enabled
  // but reasoning_content is missing in assistant tool call message at index
  // N"}}" when the agent sends a prior-turn assistant response back to Kimi.
  // The thinking block captured from the inbound response must round-trip
  // as reasoning_content on the outgoing echoed assistant message.
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [
      { role: 'user', content: 'check the logs' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect logs via Bash; running a cat.',
          },
          { type: 'text', text: "I'll inspect the logs." },
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'cat /tmp/app.log' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_bash_1',
            content: 'log line 1\nlog line 2',
          },
        ],
      },
    ],
    max_tokens: 256,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect logs via Bash; running a cat.',
  )
})

test('DeepSeek echoes reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
        ],
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe('thought')
})

test('generic OpenAI-compatible providers do not echo reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'sk-openai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
        ],
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBeUndefined()
})

test('gateway-routed DeepSeek models inherit descriptor-backed reasoning and token shaping', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'sk-openrouter-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek/deepseek-reasoner',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek/deepseek-reasoner',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
    thinking: { type: 'enabled' },
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    message => message.role === 'assistant' && Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall?.reasoning_content).toBe('thought')
  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
  expect(requestBody?.max_tokens).toBe(64)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Moonshot: cn host is also detected', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.cn/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.store).toBeUndefined()
})

test('Kimi Code endpoint inherits Moonshot max_tokens/store compatibility', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1'
  process.env.OPENAI_API_KEY = 'sk-kimi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-for-coding',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-for-coding',
    system: 'you are kimi code',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Kimi Code endpoint echoes reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1'
  process.env.OPENAI_API_KEY = 'sk-kimi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-for-coding',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-for-coding',
    system: 'you are kimi code',
    messages: [
      { role: 'user', content: 'check the logs' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect logs via Bash; running a cat.',
          },
          { type: 'text', text: "I'll inspect the logs." },
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'cat /tmp/app.log' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_bash_1',
            content: 'log line 1\nlog line 2',
          },
        ],
      },
    ],
    max_tokens: 256,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect logs via Bash; running a cat.',
  )
})

test('DeepSeek sends thinking toggle and normalized reasoning effort', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-pro',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-v4-pro',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: false,
    thinking: { type: 'enabled' },
  })

  expect(requestBody?.thinking).toEqual({ type: 'enabled' })
  expect(requestBody?.reasoning_effort).toBe('max')
  expect(requestBody?.max_tokens).toBe(64)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('DeepSeek omits thinking controls when the Anthropic-side request does not set them', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: false,
  })

  expect(requestBody?.thinking).toBeUndefined()
  expect(requestBody?.reasoning_effort).toBeUndefined()
})

test('DeepSeek forwards an explicit thinking disable toggle for V4 models', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: false,
    thinking: { type: 'disabled' },
  })

  expect(requestBody?.thinking).toEqual({ type: 'disabled' })
  expect(requestBody?.reasoning_effort).toBeUndefined()
})


test('collapses multiple text blocks in tool_result to string for DeepSeek compatibility (issue #774)', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-reasoner',
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
    model: 'deepseek-reasoner',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Run ls' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: [
              { type: 'text', text: 'line one' },
              { type: 'text', text: 'line two' },
            ],
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const toolMessages = messages.filter(m => m.role === 'tool')
  expect(toolMessages.length).toBe(1)
  expect(toolMessages[0].tool_call_id).toBe('call_1')
  expect(typeof toolMessages[0].content).toBe('string')
  expect(toolMessages[0].content).toBe('line one\n\nline two')
})

test('collapses multiple text blocks into a single string for DeepSeek compatibility (issue #774)', async () => {
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-reasoner',
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
    model: 'deepseek-reasoner',
    system: 'test system',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello!' },
          { type: 'text', text: 'How are you?' },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  expect(messages.length).toBe(2) // system + user
  expect(messages[1].role).toBe('user')
  expect(typeof messages[1].content).toBe('string')
  expect(messages[1].content).toBe('Hello!\n\nHow are you?')
})

test('preserves mixed text and image tool results as multipart content', async () => {
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
    model: 'gpt-4o',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Show me' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'cat image.png' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: [
              { type: 'text', text: 'Here is the image:' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgo=',
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

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const toolMessages = messages.filter(m => m.role === 'tool')
  expect(toolMessages.length).toBe(1)
  expect(Array.isArray(toolMessages[0].content)).toBe(true)
  const content = toolMessages[0].content as Array<Record<string, unknown>>
  expect(content.length).toBe(2)
  expect(content[0].type).toBe('text')
  expect(content[1].type).toBe('image_url')
})

test('Z.AI: uses max_tokens (not max_completion_tokens) and strips store', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'GLM-5.1',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'GLM-5.1',
    system: 'you are glm',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Z.AI: thinking mode enabled when requested', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'GLM-5.1',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'Let me think...',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'GLM-5.1',
    system: 'you are glm',
    messages: [{ role: 'user', content: 'think hard' }],
    max_tokens: 1024,
    stream: false,
    thinking: { type: 'enabled', budget_tokens: 1024 },
  })

  expect((requestBody?.thinking as Record<string, string>)?.type).toBe('enabled')
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.max_tokens).toBe(1024)
})

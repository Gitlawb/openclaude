import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getAnthropicClient } from './client.js'

type FetchType = typeof globalThis.fetch

type ShimClient = {
  beta: {
    messages: {
      create: (params: Record<string, unknown>) => Promise<unknown>
    }
  }
}

const originalFetch = globalThis.fetch
const originalMacro = (globalThis as Record<string, unknown>).MACRO
const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_SKIP_BEDROCK_AUTH: process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_FORMAT: process.env.OPENAI_API_FORMAT,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).MACRO = { VERSION: 'test-version' }
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_API_KEY = 'gemini-test-key'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash'
  process.env.GEMINI_BASE_URL = 'https://gemini.example/v1beta/openai'
  process.env.GEMINI_AUTH_MODE = 'api-key'

  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.GOOGLE_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_API_FORMAT
  delete process.env.OPENAI_MODEL
  delete process.env.MINIMAX_API_KEY
  delete process.env.XAI_API_KEY
  delete process.env.NVIDIA_NIM
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
})

afterEach(() => {
  ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('CLAUDE_CODE_USE_BEDROCK', originalEnv.CLAUDE_CODE_USE_BEDROCK)
  restoreEnv('CLAUDE_CODE_SKIP_BEDROCK_AUTH', originalEnv.CLAUDE_CODE_SKIP_BEDROCK_AUTH)
  restoreEnv('CLAUDE_CODE_USE_VERTEX', originalEnv.CLAUDE_CODE_USE_VERTEX)
  restoreEnv('CLAUDE_CODE_USE_FOUNDRY', originalEnv.CLAUDE_CODE_USE_FOUNDRY)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
  restoreEnv('CLAUDE_CODE_USE_MISTRAL', originalEnv.CLAUDE_CODE_USE_MISTRAL)
  restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
  restoreEnv('GEMINI_MODEL', originalEnv.GEMINI_MODEL)
  restoreEnv('GEMINI_BASE_URL', originalEnv.GEMINI_BASE_URL)
  restoreEnv('GEMINI_AUTH_MODE', originalEnv.GEMINI_AUTH_MODE)
  restoreEnv('GOOGLE_API_KEY', originalEnv.GOOGLE_API_KEY)
  restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_API_BASE', originalEnv.OPENAI_API_BASE)
  restoreEnv('OPENAI_API_FORMAT', originalEnv.OPENAI_API_FORMAT)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('MINIMAX_API_KEY', originalEnv.MINIMAX_API_KEY)
  restoreEnv('XAI_API_KEY', originalEnv.XAI_API_KEY)
  restoreEnv('NVIDIA_NIM', originalEnv.NVIDIA_NIM)
  restoreEnv('ANTHROPIC_API_KEY', originalEnv.ANTHROPIC_API_KEY)
  restoreEnv('ANTHROPIC_AUTH_TOKEN', originalEnv.ANTHROPIC_AUTH_TOKEN)
  restoreEnv('ANTHROPIC_BASE_URL', originalEnv.ANTHROPIC_BASE_URL)
  restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
  globalThis.fetch = originalFetch
})

test('first-party Anthropic requests execute the configured fetch wrapper without runtime symbol errors', async () => {
  let capturedHeaders: Headers | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
  delete process.env.NVIDIA_NIM
  delete process.env.ANTHROPIC_BASE_URL

  const fetchOverride = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'msg_first_party_fetch',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        container: null,
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
  }) as FetchType

  const client = await getAnthropicClient({
    apiKey: 'anthropic-test-key',
    maxRetries: 0,
    model: 'claude-sonnet-4-6',
    fetchOverride,
  })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
  })

  expect(response).toMatchObject({
    id: 'msg_first_party_fetch',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
  })
  expect(capturedHeaders).toBeDefined()
})

test('routes Gemini provider requests through the OpenAI-compatible shim', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined
  let capturedBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input, init) => {
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
        id: 'chatcmpl-gemini',
        model: 'gemini-2.0-flash',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'gemini ok',
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

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'gemini-2.0-flash',
  })) as unknown as ShimClient

  const response = await client.beta.messages.create({
    model: 'gemini-2.0-flash',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://gemini.example/v1beta/openai/chat/completions')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer gemini-test-key')
  expect(capturedBody?.model).toBe('gemini-2.0-flash')
  expect(response).toMatchObject({
    role: 'assistant',
    model: 'gemini-2.0-flash',
  })
})

test('routes env-only MiniMax requests through the OpenAI-compatible shim', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined
  let capturedBody: Record<string, unknown> | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.MINIMAX_API_KEY = 'minimax-test-key'

  globalThis.fetch = (async (input, init) => {
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
        id: 'chatcmpl-minimax',
        model: 'MiniMax-M2.5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'minimax ok',
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

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'MiniMax-M2.5',
  })) as unknown as ShimClient

  const response = await client.beta.messages.create({
    model: 'MiniMax-M2.5',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.minimax.io/v1/chat/completions')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer minimax-test-key')
  expect(capturedBody?.model).toBe('MiniMax-M2.5')
  expect(response).toMatchObject({
    role: 'assistant',
    model: 'MiniMax-M2.5',
  })
})

test('env-only MiniMax fallback preserves OpenAI-shaped model and base overrides', async () => {
  let capturedUrl: string | undefined
  let capturedBody: Record<string, unknown> | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.chat/v1'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7-highspeed'

  globalThis.fetch = (async (input, init) => {
    capturedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-minimax-override',
        model: 'MiniMax-M2.7-highspeed',
        choices: [
          {
            message: { role: 'assistant', content: 'minimax override ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'MiniMax-M2.7-highspeed',
  })) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'MiniMax-M2.7-highspeed',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.minimax.chat/v1/chat/completions')
  expect(capturedBody?.model).toBe('MiniMax-M2.7-highspeed')
  expect(process.env.OPENAI_API_KEY).toBe('minimax-test-key')
})

test('env-only MiniMax fallback ignores stale OPENAI_API_BASE when primary base matches', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.chat/v1'
  process.env.OPENAI_API_BASE = 'https://api.openai.com/v1'

  await getAnthropicClient({
    maxRetries: 0,
    model: 'MiniMax-M2.7',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(process.env.OPENAI_BASE_URL).toBe('https://api.minimax.chat/v1')
  expect(process.env.OPENAI_API_KEY).toBe('minimax-test-key')
})

test('env-only MiniMax fallback preserves OPENAI_API_BASE host overrides', async () => {
  let capturedUrl: string | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.OPENAI_API_BASE = 'https://api.minimax.chat/v1'

  globalThis.fetch = (async (input) => {
    capturedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-minimax-api-base',
        model: 'MiniMax-M2.7',
        choices: [
          {
            message: { role: 'assistant', content: 'minimax api base ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'MiniMax-M2.7',
  })) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'MiniMax-M2.7',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.minimax.chat/v1/chat/completions')
  expect(process.env.OPENAI_BASE_URL).toBe('https://api.minimax.chat/v1')
})

test('env-only MiniMax fallback drops unsupported OpenAI shim options', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.OPENAI_API_FORMAT = 'responses'
  process.env.OPENAI_AUTH_HEADER = 'api-key'
  process.env.OPENAI_AUTH_SCHEME = 'raw'
  process.env.OPENAI_AUTH_HEADER_VALUE = 'stale-header-value'

  globalThis.fetch = (async (input, init) => {
    capturedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-minimax-clean',
        model: 'MiniMax-M2.7',
        choices: [
          {
            message: { role: 'assistant', content: 'minimax clean ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'MiniMax-M2.7',
  })) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'MiniMax-M2.7',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.minimax.io/v1/chat/completions')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer minimax-test-key')
  expect(capturedHeaders?.get('api-key')).toBeNull()
  expect(process.env.OPENAI_API_FORMAT).toBeUndefined()
  expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
  expect(process.env.OPENAI_AUTH_SCHEME).toBeUndefined()
  expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
})

test('env-only MiniMax fallback replaces stale non-MiniMax model env', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key'
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.OPENAI_MODEL = 'gpt-4o'

  await getAnthropicClient({
    maxRetries: 0,
    model: 'MiniMax-M2.7',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(process.env.OPENAI_MODEL).toBe('MiniMax-M2.7')
  expect(process.env.OPENAI_API_KEY).toBe('minimax-test-key')
})

test('env-only MiniMax fallback does not override explicit OpenAI credentials', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key'
  process.env.OPENAI_API_KEY = 'openai-test-key'
  process.env.MINIMAX_API_KEY = 'minimax-test-key'

  await getAnthropicClient({
    maxRetries: 0,
    model: 'gpt-4o',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.OPENAI_API_KEY).toBe('openai-test-key')
  expect(process.env.OPENAI_BASE_URL).toBeUndefined()
  expect(process.env.OPENAI_MODEL).toBeUndefined()
})

test('env-only MiniMax fallback ignores non-MiniMax base overrides', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key'
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7'

  await getAnthropicClient({
    maxRetries: 0,
    model: 'MiniMax-M2.7',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.OPENAI_API_KEY).toBeUndefined()
  expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
  expect(process.env.OPENAI_MODEL).toBe('MiniMax-M2.7')
})

test('routes env-only xAI requests through the OpenAI-compatible shim', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined
  let capturedBody: Record<string, unknown> | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.XAI_API_KEY = 'xai-test-key'

  globalThis.fetch = (async (input, init) => {
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
        id: 'chatcmpl-xai',
        model: 'grok-4',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'xai ok',
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

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'grok-4',
  })) as unknown as ShimClient

  const response = await client.beta.messages.create({
    model: 'grok-4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.x.ai/v1/chat/completions')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer xai-test-key')
  expect(capturedBody?.model).toBe('grok-4')
  expect(response).toMatchObject({
    role: 'assistant',
    model: 'grok-4',
  })
})

test('env-only xAI fallback replaces stale OpenAI credentials and model env', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.XAI_API_KEY = 'xai-test-key'
  process.env.OPENAI_API_KEY = 'openai-test-key'
  process.env.OPENAI_MODEL = 'gpt-4o'

  await getAnthropicClient({
    maxRetries: 0,
    model: 'grok-4',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(process.env.OPENAI_MODEL).toBe('grok-4')
  expect(process.env.OPENAI_API_KEY).toBe('xai-test-key')
})

test('env-only xAI fallback preserves xAI OPENAI_API_BASE host overrides', async () => {
  let capturedUrl: string | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.XAI_API_KEY = 'xai-test-key'
  process.env.OPENAI_API_BASE = 'https://api.x.ai/v1'

  globalThis.fetch = (async (input) => {
    capturedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-xai-api-base',
        model: 'grok-4',
        choices: [
          {
            message: { role: 'assistant', content: 'xai api base ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'grok-4',
  })) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'grok-4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.x.ai/v1/chat/completions')
  expect(process.env.OPENAI_BASE_URL).toBe('https://api.x.ai/v1')
})

test('env-only xAI fallback drops unsupported OpenAI shim options', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.XAI_API_KEY = 'xai-test-key'
  process.env.OPENAI_API_FORMAT = 'responses'
  process.env.OPENAI_AUTH_HEADER = 'api-key'
  process.env.OPENAI_AUTH_SCHEME = 'raw'
  process.env.OPENAI_AUTH_HEADER_VALUE = 'stale-header-value'

  globalThis.fetch = (async (input, init) => {
    capturedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-xai-clean',
        model: 'grok-4',
        choices: [
          {
            message: { role: 'assistant', content: 'xai clean ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'grok-4',
  })) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'grok-4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.x.ai/v1/chat/completions')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer xai-test-key')
  expect(capturedHeaders?.get('api-key')).toBeNull()
  expect(process.env.OPENAI_API_FORMAT).toBeUndefined()
  expect(process.env.OPENAI_AUTH_HEADER).toBeUndefined()
  expect(process.env.OPENAI_AUTH_SCHEME).toBeUndefined()
  expect(process.env.OPENAI_AUTH_HEADER_VALUE).toBeUndefined()
})

test('env-only xAI fallback ignores non-xAI base overrides', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key'
  process.env.XAI_API_KEY = 'xai-test-key'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'grok-4'

  await getAnthropicClient({
    maxRetries: 0,
    model: 'grok-4',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.OPENAI_API_KEY).toBeUndefined()
  expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
  expect(process.env.OPENAI_MODEL).toBe('grok-4')
})

test('env-only xAI wins when MiniMax key is also present', async () => {
  let capturedUrl: string | undefined
  let capturedHeaders: Headers | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  process.env.XAI_API_KEY = 'xai-test-key'

  globalThis.fetch = (async (input, init) => {
    capturedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-xai',
        model: 'grok-4',
        choices: [
          {
            message: { role: 'assistant', content: 'xai ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as FetchType

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'grok-4',
  })) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'grok-4',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedUrl).toBe('https://api.x.ai/v1/chat/completions')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer xai-test-key')
  expect(process.env.OPENAI_API_KEY).toBe('xai-test-key')
})

test('env-only MiniMax fallback yields to explicit Bedrock selection', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
  process.env.MINIMAX_API_KEY = 'minimax-test-key'

  globalThis.fetch = (async () => {
    throw new Error('MiniMax/OpenAI shim fetch should not run')
  }) as FetchType

  await getAnthropicClient({
    maxRetries: 0,
    model: 'claude-sonnet-4-6',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.OPENAI_BASE_URL).toBeUndefined()
  expect(process.env.OPENAI_MODEL).toBeUndefined()
  expect(process.env.OPENAI_API_KEY).toBeUndefined()
})

test('env-only xAI fallback yields to explicit Bedrock selection', async () => {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_AUTH_MODE
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
  process.env.XAI_API_KEY = 'xai-test-key'

  globalThis.fetch = (async () => {
    throw new Error('xAI/OpenAI shim fetch should not run')
  }) as FetchType

  await getAnthropicClient({
    maxRetries: 0,
    model: 'claude-sonnet-4-6',
  })

  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.OPENAI_BASE_URL).toBeUndefined()
  expect(process.env.OPENAI_MODEL).toBeUndefined()
  expect(process.env.OPENAI_API_KEY).toBeUndefined()
})

test('strips Anthropic-specific custom headers before sending OpenAI-compatible shim requests', async () => {
  let capturedHeaders: Headers | undefined

  delete process.env.CLAUDE_CODE_USE_GEMINI
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_API_KEY = 'openai-test-key'
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  process.env.OPENAI_MODEL = 'gpt-4o'
  process.env.ANTHROPIC_CUSTOM_HEADERS = [
    'anthropic-version: 2023-06-01',
    'anthropic-beta: prompt-caching-2024-07-31',
    'x-anthropic-additional-protection: true',
    'x-claude-remote-session-id: remote-123',
    'x-app: cli',
    'api-key: custom-provider-key',
    'x-safe-header: keep-me',
  ].join('\n')

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-openai',
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

  const client = (await getAnthropicClient({
    maxRetries: 0,
    model: 'gpt-4o',
  })) as unknown as ShimClient

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
  expect(capturedHeaders?.get('api-key')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer openai-test-key')
})

test('strips Anthropic-specific custom headers on providerOverride shim requests too', async () => {
  let capturedHeaders: Headers | undefined

  process.env.ANTHROPIC_CUSTOM_HEADERS = [
    'anthropic-version: 2023-06-01',
    'anthropic-beta: prompt-caching-2024-07-31',
    'x-claude-remote-session-id: remote-123',
    'api-key: custom-provider-key',
    'x-safe-header: keep-me',
  ].join('\n')

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-provider-override',
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

  const client = (await getAnthropicClient({
    maxRetries: 0,
    providerOverride: {
      model: 'gpt-4o',
      baseURL: 'http://example.test/v1',
      apiKey: 'provider-test-key',
    },
  })) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'unused',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('anthropic-version')).toBeNull()
  expect(capturedHeaders?.get('anthropic-beta')).toBeNull()
  expect(capturedHeaders?.get('x-claude-remote-session-id')).toBeNull()
  expect(capturedHeaders?.get('api-key')).toBeNull()
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer provider-test-key')
})

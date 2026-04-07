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
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).MACRO = { VERSION: 'test-version' }
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_API_KEY = 'gemini-test-key'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash'
  process.env.GEMINI_BASE_URL = 'https://gemini.example/v1beta/openai'

  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.GOOGLE_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
})

afterEach(() => {
  ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.CLAUDE_CODE_USE_GEMINI = originalEnv.CLAUDE_CODE_USE_GEMINI
  process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY
  process.env.GEMINI_MODEL = originalEnv.GEMINI_MODEL
  process.env.GEMINI_BASE_URL = originalEnv.GEMINI_BASE_URL
  process.env.GOOGLE_API_KEY = originalEnv.GOOGLE_API_KEY
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
  process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_AUTH_TOKEN = originalEnv.ANTHROPIC_AUTH_TOKEN
  process.env.ANTHROPIC_CUSTOM_HEADERS = originalEnv.ANTHROPIC_CUSTOM_HEADERS
  globalThis.fetch = originalFetch
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

test('strips Anthropic-specific custom headers before sending OpenAI-compatible shim requests', async () => {
  let capturedHeaders: Headers | undefined

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
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer openai-test-key')
})

test('strips Anthropic-specific custom headers on providerOverride shim requests too', async () => {
  let capturedHeaders: Headers | undefined

  process.env.ANTHROPIC_CUSTOM_HEADERS = [
    'anthropic-version: 2023-06-01',
    'anthropic-beta: prompt-caching-2024-07-31',
    'x-claude-remote-session-id: remote-123',
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
  expect(capturedHeaders?.get('x-safe-header')).toBe('keep-me')
  expect(capturedHeaders?.get('authorization')).toBe('Bearer provider-test-key')
})

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
  CLAUDE_CODE_GOOGLE: process.env.CLAUDE_CODE_GOOGLE,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
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
  process.env.CLAUDE_CODE_GOOGLE = '1'
  process.env.GEMINI_API_KEY = 'gemini-test-key'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash'
  process.env.GEMINI_BASE_URL = 'https://gemini.example/v1beta/openai'
  process.env.GEMINI_AUTH_MODE = 'api-key'

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
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('CLAUDE_CODE_GOOGLE', originalEnv.CLAUDE_CODE_GOOGLE)
  restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
  restoreEnv('GEMINI_MODEL', originalEnv.GEMINI_MODEL)
  restoreEnv('GEMINI_BASE_URL', originalEnv.GEMINI_BASE_URL)
  restoreEnv('GEMINI_AUTH_MODE', originalEnv.GEMINI_AUTH_MODE)
  restoreEnv('GOOGLE_API_KEY', originalEnv.GOOGLE_API_KEY)
  restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('ANTHROPIC_API_KEY', originalEnv.ANTHROPIC_API_KEY)
  restoreEnv('ANTHROPIC_AUTH_TOKEN', originalEnv.ANTHROPIC_AUTH_TOKEN)
  restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
  globalThis.fetch = originalFetch
})

test('routes Gemini provider requests through the native Gemini shim', async () => {
  let capturedUrl: string | undefined
  let capturedBody: Record<string, unknown> | undefined

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
        candidates: [
          {
            content: {
              parts: [{ text: 'gemini ok' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 3,
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

  // Native Gemini shim calls the Generative AI endpoint, not OpenAI-compatible
  expect(capturedUrl).toContain('generativelanguage.googleapis.com')
  expect(capturedUrl).toContain('generateContent')
  expect(response).toMatchObject({
    role: 'assistant',
  })
})

test('strips Anthropic-specific custom headers before sending OpenAI-compatible shim requests', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_GOOGLE
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

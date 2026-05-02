import { afterEach, expect, test } from 'bun:test'

import {
  getAdditionalModelOptionsCacheScope,
  getLocalProviderRetryBaseUrls,
  isLocalProviderUrl,
  resolveProviderRequest,
  shouldAttemptLocalToollessRetry,
} from './providerConfig.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_AUTH_HEADER: process.env.OPENAI_AUTH_HEADER,
  OPENAI_AUTH_SCHEME: process.env.OPENAI_AUTH_SCHEME,
  OPENAI_AUTH_HEADER_VALUE: process.env.OPENAI_AUTH_HEADER_VALUE,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_API_FORMAT: process.env.OPENAI_API_FORMAT,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
  restoreEnv('OPENAI_AUTH_HEADER', originalEnv.OPENAI_AUTH_HEADER)
  restoreEnv('OPENAI_AUTH_SCHEME', originalEnv.OPENAI_AUTH_SCHEME)
  restoreEnv('OPENAI_AUTH_HEADER_VALUE', originalEnv.OPENAI_AUTH_HEADER_VALUE)
  restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('OPENAI_API_FORMAT', originalEnv.OPENAI_API_FORMAT)
})

test('treats localhost endpoints as local', () => {
  expect(isLocalProviderUrl('http://localhost:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://127.0.0.1:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://0.0.0.0:11434/v1')).toBe(true)
  // Full 127.0.0.0/8 loopback range should be treated as local
  expect(isLocalProviderUrl('http://127.0.0.2:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://127.1.2.3:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://127.255.255.255:11434/v1')).toBe(true)
})

test('treats private IPv4 endpoints as local', () => {
  expect(isLocalProviderUrl('http://10.0.0.1:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://172.16.0.1:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://192.168.0.1:11434/v1')).toBe(true)
})

test('treats .local hostnames as local', () => {
  expect(isLocalProviderUrl('http://ollama.local:11434/v1')).toBe(true)
})

test('treats private IPv6 endpoints as local', () => {
  expect(isLocalProviderUrl('http://[fd00::1]:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://[fe80::1]:11434/v1')).toBe(true)
  expect(isLocalProviderUrl('http://[::1]:11434/v1')).toBe(true)
})

test('treats public hosts as remote', () => {
  expect(isLocalProviderUrl('http://203.0.113.1:11434/v1')).toBe(false)
  expect(isLocalProviderUrl('https://example.com/v1')).toBe(false)
  expect(isLocalProviderUrl('http://[2001:4860:4860::8888]:11434/v1')).toBe(false)
})

test('creates a cache scope for local openai-compatible providers', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://localhost:1234/v1'
  process.env.OPENAI_MODEL = 'llama-3.2-3b-instruct'

  expect(getAdditionalModelOptionsCacheScope()?.startsWith(
    'openai:http://localhost:1234/v1:',
  )).toBe(true)
})

test('keeps codex alias models on chat completions for local openai-compatible providers', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8080/v1'
  process.env.OPENAI_MODEL = 'gpt-5.4'

  expect(resolveProviderRequest()).toMatchObject({
    transport: 'chat_completions',
    requestedModel: 'gpt-5.4',
    resolvedModel: 'gpt-5.4',
    baseUrl: 'http://127.0.0.1:8080/v1',
  })
  expect(getAdditionalModelOptionsCacheScope()?.startsWith(
    'openai:http://127.0.0.1:8080/v1:',
  )).toBe(true)
})

test('partitions local openai-compatible model cache scope by credentials and headers', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://localhost:1234/v1'
  process.env.OPENAI_MODEL = 'llama-3.2-3b-instruct'
  process.env.OPENAI_API_KEY = 'first-key'
  process.env.ANTHROPIC_CUSTOM_HEADERS = 'X-Route: first'

  const firstScope = getAdditionalModelOptionsCacheScope()

  process.env.OPENAI_API_KEY = 'second-key'
  const secondScope = getAdditionalModelOptionsCacheScope()

  process.env.OPENAI_API_KEY = 'first-key'
  process.env.ANTHROPIC_CUSTOM_HEADERS = 'X-Route: second'
  const thirdScope = getAdditionalModelOptionsCacheScope()

  expect(firstScope).not.toBe(secondScope)
  expect(firstScope).not.toBe(thirdScope)
  expect(firstScope?.startsWith('openai:http://localhost:1234/v1:')).toBe(true)
})

test('uses responses transport when OpenAI-compatible API format requests responses', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.4'
  process.env.OPENAI_API_FORMAT = 'responses'

  expect(resolveProviderRequest()).toMatchObject({
    transport: 'responses',
    requestedModel: 'gpt-5.4',
    resolvedModel: 'gpt-5.4',
    baseUrl: 'https://api.openai.com/v1',
  })
})

test('uses responses transport for Hicap gpt models when requested', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.hicap.ai/v1'
  process.env.OPENAI_MODEL = 'gpt-5.4'
  process.env.OPENAI_API_FORMAT = 'responses'

  expect(resolveProviderRequest()).toMatchObject({
    transport: 'responses',
    requestedModel: 'gpt-5.4',
    resolvedModel: 'gpt-5.4',
    baseUrl: 'https://api.hicap.ai/v1',
  })
})

test('falls back to chat completions for non-gpt Hicap models when responses is requested', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.hicap.ai/v1'
  process.env.OPENAI_MODEL = 'claude-opus-4.6'
  process.env.OPENAI_API_FORMAT = 'responses'

  expect(resolveProviderRequest()).toMatchObject({
    transport: 'chat_completions',
    requestedModel: 'claude-opus-4.6',
    resolvedModel: 'claude-opus-4.6',
    baseUrl: 'https://api.hicap.ai/v1',
  })
})

test('keeps Codex backend on Codex responses transport even when API format is set', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = 'codexplan'
  process.env.OPENAI_API_FORMAT = 'chat_completions'

  expect(resolveProviderRequest()).toMatchObject({
    transport: 'codex_responses',
    requestedModel: 'codexplan',
    resolvedModel: 'gpt-5.5',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
  })
})

test('skips local model cache scope for remote openai-compatible providers', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-4o'

  expect(getAdditionalModelOptionsCacheScope()).toBeNull()
})

test('derives local retry base URLs with /v1 and loopback fallback candidates', () => {
  expect(getLocalProviderRetryBaseUrls('http://localhost:11434')).toEqual([
    'http://localhost:11434/v1',
    'http://127.0.0.1:11434',
    'http://127.0.0.1:11434/v1',
  ])
})

test('does not derive local retry base URLs for remote providers', () => {
  expect(getLocalProviderRetryBaseUrls('https://api.openai.com/v1')).toEqual([])
})

test('enables local toolless retry for likely Ollama endpoints with tools', () => {
  expect(
    shouldAttemptLocalToollessRetry({
      baseUrl: 'http://localhost:11434/v1',
      hasTools: true,
    }),
  ).toBe(true)
})

test('disables local toolless retry when no tools are present', () => {
  expect(
    shouldAttemptLocalToollessRetry({
      baseUrl: 'http://localhost:11434/v1',
      hasTools: false,
    }),
  ).toBe(false)
})

test('disables local toolless retry for non-Ollama local endpoints', () => {
  expect(
    shouldAttemptLocalToollessRetry({
      baseUrl: 'http://localhost:1234/v1',
      hasTools: true,
    }),
  ).toBe(false)
})

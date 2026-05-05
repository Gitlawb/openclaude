import { expect, test } from 'bun:test'

import {
  buildOpenAICompatibilityErrorMessage,
  classifyOpenAIHttpFailure,
  classifyOpenAINetworkFailure,
  extractOpenAICategoryHost,
  extractOpenAICategoryMarker,
  formatOpenAICategoryMarker,
  isLocalhostLikeHost,
} from './openaiErrorClassification.js'

test('classifies localhost ECONNREFUSED as connection_refused', () => {
  const error = Object.assign(new TypeError('fetch failed'), {
    code: 'ECONNREFUSED',
  })

  const failure = classifyOpenAINetworkFailure(error, {
    url: 'http://localhost:11434/v1/chat/completions',
  })

  expect(failure.category).toBe('connection_refused')
  expect(failure.retryable).toBe(true)
  expect(failure.code).toBe('ECONNREFUSED')
  expect(failure.hint).toContain('local server is running')
})

test('classifies localhost ENOTFOUND as localhost_resolution_failed', () => {
  const error = Object.assign(new TypeError('getaddrinfo ENOTFOUND localhost'), {
    code: 'ENOTFOUND',
  })

  const failure = classifyOpenAINetworkFailure(error, {
    url: 'http://localhost:11434/v1/chat/completions',
  })

  expect(failure.category).toBe('localhost_resolution_failed')
  expect(failure.retryable).toBe(true)
  expect(failure.code).toBe('ENOTFOUND')
  expect(failure.hint).toContain('127.0.0.1')
})

test('classifies model-not-found 404 responses', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'The model qwen2.5-coder:7b was not found',
  })

  expect(failure.category).toBe('model_not_found')
  expect(failure.retryable).toBe(false)
})

test('classifies generic 404 responses as endpoint_not_found', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'Not Found',
  })

  expect(failure.category).toBe('endpoint_not_found')
  expect(failure.hint).toContain('/v1')
})

test('classifies context-overflow responses', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 500,
    body: 'request too large: maximum context length exceeded',
  })

  expect(failure.category).toBe('context_overflow')
  expect(failure.retryable).toBe(false)
})

test('classifies tool compatibility failures', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 400,
    body: 'tool_calls are not supported by this model',
  })

  expect(failure.category).toBe('tool_call_incompatible')
})

test('embeds and extracts category markers in formatted messages', () => {
  const marker = formatOpenAICategoryMarker('endpoint_not_found')
  expect(marker).toBe('[openai_category=endpoint_not_found]')

  const formatted = buildOpenAICompatibilityErrorMessage('OpenAI API error 404: Not Found', {
    category: 'endpoint_not_found',
    hint: 'Confirm OPENAI_BASE_URL includes /v1.',
  })

  expect(formatted).toContain('[openai_category=endpoint_not_found]')
  expect(formatted).toContain('Hint: Confirm OPENAI_BASE_URL includes /v1.')
  expect(extractOpenAICategoryMarker(formatted)).toBe('endpoint_not_found')
})

test('ignores unknown category markers during extraction', () => {
  const malformed = 'OpenAI API error 500 [openai_category=totally_fake_category]'
  expect(extractOpenAICategoryMarker(malformed)).toBeUndefined()
})

test('endpoint_not_found 404 from a remote host gets a host-aware hint (issue #926)', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'Not Found',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
  })

  expect(failure.category).toBe('endpoint_not_found')
  expect(failure.requestUrl).toBe('https://integrate.api.nvidia.com/v1/chat/completions')
  expect(failure.hint).toContain('integrate.api.nvidia.com')
  expect(failure.hint).not.toContain('local providers')
})

test('endpoint_not_found 404 from localhost keeps the Ollama-flavored hint', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'Not Found',
    url: 'http://127.0.0.1:11434/v1/chat/completions',
  })

  expect(failure.category).toBe('endpoint_not_found')
  expect(failure.hint).toContain('local providers')
})

test('marker round-trip preserves host segment', () => {
  const formatted = buildOpenAICompatibilityErrorMessage(
    'OpenAI API error 404: Not Found',
    {
      category: 'endpoint_not_found',
      hint: 'Endpoint at integrate.api.nvidia.com returned 404.',
      requestUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    },
  )

  expect(formatted).toContain('[openai_category=endpoint_not_found,host=integrate.api.nvidia.com]')
  expect(extractOpenAICategoryMarker(formatted)).toBe('endpoint_not_found')
  expect(extractOpenAICategoryHost(formatted)).toBe('integrate.api.nvidia.com')
})

test('marker without host stays backward-compatible', () => {
  const marker = formatOpenAICategoryMarker('endpoint_not_found')
  expect(marker).toBe('[openai_category=endpoint_not_found]')
  expect(extractOpenAICategoryMarker(marker)).toBe('endpoint_not_found')
  expect(extractOpenAICategoryHost(marker)).toBeUndefined()
})

test('isLocalhostLikeHost matches loopback variants', () => {
  expect(isLocalhostLikeHost('localhost')).toBe(true)
  expect(isLocalhostLikeHost('127.0.0.1')).toBe(true)
  expect(isLocalhostLikeHost('127.0.0.5')).toBe(true)
  expect(isLocalhostLikeHost('::1')).toBe(true)
  expect(isLocalhostLikeHost('integrate.api.nvidia.com')).toBe(false)
  expect(isLocalhostLikeHost(undefined)).toBe(false)
})

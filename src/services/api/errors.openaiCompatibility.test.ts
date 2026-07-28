import { APIError } from '@anthropic-ai/sdk'
import { expect, test } from 'bun:test'

import { getAssistantMessageFromError } from './errors.js'

function getFirstText(message: ReturnType<typeof getAssistantMessageFromError>): string {
  const first = message.message.content[0]
  if (!first || typeof first !== 'object' || !('text' in first)) {
    return ''
  }
  return typeof first.text === 'string' ? first.text : ''
}

test('maps endpoint_not_found category markers to actionable setup guidance', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=endpoint_not_found] Hint: Confirm OPENAI_BASE_URL includes /v1.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen2.5-coder:7b')
  const text = getFirstText(message)

  expect(message.isApiErrorMessage).toBe(true)
  expect(text).toContain('Provider endpoint was not found')
  expect(text).toContain('OPENAI_BASE_URL')
  expect(text).toContain('/v1')
})

test('vision_not_supported shows image-specific guidance (issue #1421 canonical message)', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=vision_not_supported,host=opengateway.gitlawb.com] Hint: The provider returned 404 for a request containing images.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'mimo-v2.5-pro')
  const text = getFirstText(message)

  expect(message.isApiErrorMessage).toBe(true)
  expect(text).toContain('image')
  expect(text).toContain('does not support')
  // The command is `/model` in interactive sessions and `--model` in
  // non-interactive (test/SDK) sessions — both forms are intentional.
  expect(text).toMatch(/(\/model|--model)/)
  expect(text).not.toContain('OPENAI_BASE_URL')
})

test('vision_not_supported from Xiaomi Mimo 400 "text is not set" uses the same canonical message (issue #1421)', () => {
  const error = APIError.generate(
    400,
    undefined,
    'OpenAI API error 400: {"error":{"code":"400","message":"Param Incorrect","param":"`text` is not set"}} [openai_category=vision_not_supported,host=api.xiaomimimo.com] Hint: The provider rejected an image-bearing request because it lacked a text part.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'mimo-v2.5-pro')
  const text = getFirstText(message)

  expect(message.isApiErrorMessage).toBe(true)
  expect(text).toContain('image')
  expect(text).toContain('does not support')
  expect(text).toMatch(/(\/model|--model)/)
  expect(text).not.toContain('OPENAI_BASE_URL')
})

test('endpoint_not_found from a remote host shows the actual host, not Ollama (issue #926)', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=endpoint_not_found,host=integrate.api.nvidia.com] Hint: Endpoint at integrate.api.nvidia.com returned 404.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'moonshotai/kimi-k2.5-thinking')
  const text = getFirstText(message)

  expect(text).toContain('integrate.api.nvidia.com')
  expect(text).toContain('moonshotai/kimi-k2.5-thinking')
  expect(text).not.toContain('Ollama')
  expect(text).not.toContain('11434')
})

test('endpoint_not_found without a host falls back to the Ollama-aware message', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=endpoint_not_found] Hint: Confirm OPENAI_BASE_URL includes /v1.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen2.5-coder:7b')
  const text = getFirstText(message)

  expect(text).toContain('Provider endpoint was not found')
  expect(text).toContain('Ollama')
})

test('auth_invalid guidance names singular and pooled OpenAI credentials', () => {
  const error = APIError.generate(
    401,
    undefined,
    'OpenAI API error 401: Unauthorized [openai_category=auth_invalid,host=api.openai.com] Hint: Authentication failed.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'gpt-4o')
  const text = getFirstText(message)

  expect(text).toContain('Authentication failed')
  expect(text).toContain('OPENAI_API_KEYS')
  expect(text).toContain('OPENAI_API_KEY')
})

test('maps tool_call_incompatible category markers to model/tool guidance', () => {
  const error = APIError.generate(
    400,
    undefined,
    'OpenAI API error 400: tool_calls are not supported [openai_category=tool_call_incompatible]',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen2.5-coder:7b')
  const text = getFirstText(message)

  expect(text).toContain('rejected tool-calling payloads')
  expect(text).toContain('/model')
})

test('maps tool_stream_unsupported without promising a retry after failure', () => {
  const error = APIError.generate(
    400,
    undefined,
    'OpenAI API error 400: tool_stream is unsupported [openai_category=tool_stream_unsupported]',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'glm-5.2')
  const text = getFirstText(message)

  expect(text).toContain('rejected the `tool_stream` parameter')
  expect(text).toContain('cannot be streamed')
  expect(text).toContain('switch models')
  expect(text).toMatch(/(\/model|--model)/)
  expect(text).not.toContain('Retrying')
})

test('request_timeout echoes the API_TIMEOUT_MS note from describeApiTimeoutEnvForError', () => {
  const saved = process.env.API_TIMEOUT_MS
  const makeMessage = () => {
    const error = APIError.generate(
      408,
      undefined,
      'OpenAI API error 408: Request timed out [openai_category=request_timeout]',
      new Headers(),
    )
    return getFirstText(getAssistantMessageFromError(error, 'llama3.3:70b'))
  }
  try {
    // Unset: keep the generic advice to raise the knob.
    delete process.env.API_TIMEOUT_MS
    const unset = makeMessage()
    expect(unset).toContain('Provider request timed out')
    expect(unset).toContain('retry shortly or increase API_TIMEOUT_MS')

    // Valid: echo the effective timeout instead of the generic advice.
    process.env.API_TIMEOUT_MS = '900000'
    const valid = makeMessage()
    expect(valid).toContain('(API_TIMEOUT_MS=900000ms, try increasing it)')

    // Invalid: say it was ignored -- do not advise raising a knob that never
    // took effect.
    process.env.API_TIMEOUT_MS = '30s'
    const invalid = makeMessage()
    expect(invalid).toContain(
      '(API_TIMEOUT_MS=30s is not a positive integer (ms) and was ignored)',
    )
    expect(invalid).not.toContain('increase API_TIMEOUT_MS')
  } finally {
    if (saved === undefined) {
      delete process.env.API_TIMEOUT_MS
    } else {
      process.env.API_TIMEOUT_MS = saved
    }
  }
})

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

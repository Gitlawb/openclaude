import { APIError } from '@anthropic-ai/sdk'
import { expect, test } from 'bun:test'

import {
  getAssistantMessageFromError,
  parseProviderMaxTokensCap,
} from './errors.js'

function textOf(message: ReturnType<typeof getAssistantMessageFromError>): string {
  const first = message.message.content[0]
  return first && typeof first === 'object' && 'text' in first
    ? String(first.text)
    : ''
}

test('does not parse OpenRouter affordability errors owned by withRetry', () => {
  expect(
    parseProviderMaxTokensCap(
      'requested up to 32000 tokens, but can only afford 27342.',
    ),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap(
      'requested up to 32,000 tokens, but can only afford 27,342',
    ),
  ).toBeUndefined()
})

test('parses provider maximum output token errors for max_tokens', () => {
  expect(
    parseProviderMaxTokensCap(
      'max_tokens exceeds maximum output tokens for this model: 8192',
    ),
  ).toBe(8_192)
})

test('parses provider maximum output token errors for max_completion_tokens', () => {
  expect(
    parseProviderMaxTokensCap(
      'max_completion_tokens must be less than or equal to the maximum output tokens 16384',
    ),
  ).toBe(16_384)
  expect(
    parseProviderMaxTokensCap(
      'max_completion_tokens exceeds maximum completion tokens for this model: 16384',
    ),
  ).toBe(16_384)
})

test('does not parse malformed or unsafe provider caps', () => {
  expect(parseProviderMaxTokensCap('max_tokens exceeds maximum output tokens')).toBeUndefined()
  expect(
    parseProviderMaxTokensCap(
      'input length and max_tokens exceed maximum context length: 32000 + 8192 > 32768',
    ),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap(
      'max_tokens exceeds maximum output tokens for this model: 0',
    ),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap(
      'max_tokens exceeds maximum output tokens for this model: 9007199254740992',
    ),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap(
      'max_tokens exceeds maximum output tokens for this model: 27342.5',
    ),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap(
      'max_tokens exceeds maximum output tokens for this model: 27342,',
    ),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap(
      'max_tokens exceeds maximum output tokens for this model: 27,34',
    ),
  ).toBeUndefined()
})

test('does not parse non-token affordability messages', () => {
  expect(parseProviderMaxTokensCap('can only afford 27342')).toBeUndefined()
  expect(
    parseProviderMaxTokensCap('account can only afford 5 credits'),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap('quota can only afford 100 requests'),
  ).toBeUndefined()
  expect(
    parseProviderMaxTokensCap('billing can only afford 42 units'),
  ).toBeUndefined()
})

test('classifies provider max token cap errors for query recovery', () => {
  const error = APIError.generate(
    400,
    undefined,
    'OpenAI API error 400: max_tokens exceeds maximum output tokens for this model: 27342',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'openrouter/model')

  expect(message.isApiErrorMessage).toBe(true)
  expect(message.apiError).toBe('max_tokens_too_high')
  expect(message.error).toBe('invalid_request')
  expect(message.errorDetails).toContain('maximum output tokens')
  expect(textOf(message)).toContain('Provider max_tokens limit was lower than requested')
})

test('classifies marker-wrapped maximum output token errors before generic markers', () => {
  const error = APIError.generate(
    400,
    undefined,
    'OpenAI API error 400: max_tokens exceeds maximum output tokens for this model: 27342 [openai_category=unknown]',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'openrouter/model')

  expect(message.apiError).toBe('max_tokens_too_high')
  expect(message.error).toBe('invalid_request')
  expect(textOf(message)).not.toContain('openai_category=unknown')
})

test('does not classify OpenRouter affordability errors for query recovery', () => {
  const error = APIError.generate(
    402,
    undefined,
    'This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 27342.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'openrouter/model')

  expect(message.apiError).not.toBe('max_tokens_too_high')
  expect(message.error).toBe('unknown')
  expect(textOf(message)).toContain('API Error')
  expect(textOf(message)).toContain('can only afford 27342')
})

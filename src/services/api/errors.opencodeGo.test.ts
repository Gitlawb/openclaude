import { APIError } from '@anthropic-ai/sdk'
import { afterEach, expect, test } from 'bun:test'

import {
  classifyAPIError,
  getAssistantMessageFromError,
  OPENCODE_GO_FREE_LIMIT_ERROR_MESSAGE,
  OPENCODE_GO_USAGE_LIMIT_ERROR_MESSAGE,
} from './errors.js'

function getFirstText(message: ReturnType<typeof getAssistantMessageFromError>): string {
  const first = message.message.content[0]
  if (!first || typeof first !== 'object' || !('text' in first)) {
    return ''
  }
  return typeof first.text === 'string' ? first.text : ''
}

const originalBaseUrl = process.env.OPENAI_BASE_URL

afterEach(() => {
  if (originalBaseUrl === undefined) {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = originalBaseUrl
  }
})

function makeGoError(body: string, headers?: Record<string, string>): APIError {
  const h = new Headers({
    'x-opencode-request-url': 'https://opencode.ai/zen/go/v1/messages',
    ...(headers ?? {}),
  })
  return APIError.generate(429, undefined, body, h)
}

test('FreeUsageLimitError surfaces the free-tier upgrade message', () => {
  const error = makeGoError(
    JSON.stringify({
      error: {
        type: 'FreeUsageLimitError',
        message: 'free usage limit reached',
      },
    }),
  )
  const message = getAssistantMessageFromError(error, 'glm-4.6')
  const text = getFirstText(message)

  expect(message.isApiErrorMessage).toBe(true)
  expect(text).toBe(OPENCODE_GO_FREE_LIMIT_ERROR_MESSAGE)
  expect(text).toContain('Subscribe at https://opencode.ai/go')
})

test('GoUsageLimitError surfaces the subscription message with reset and workspace', () => {
  const error = makeGoError(
    JSON.stringify({
      error: {
        type: 'GoUsageLimitError',
        message: 'go subscription limit reached',
        limitName: 'weekly',
        workspace: 'euxaristia-personal',
      },
    }),
    { 'retry-after': '172800' }, // 2 days
  )
  const message = getAssistantMessageFromError(error, 'glm-4.6')
  const text = getFirstText(message)

  expect(message.isApiErrorMessage).toBe(true)
  expect(text).toContain(OPENCODE_GO_USAGE_LIMIT_ERROR_MESSAGE)
  expect(text).toContain('Resets in 2d')
  expect(text).toContain('Workspace: euxaristia-personal')
  expect(text).toContain('Limit: weekly')
})

test('GoUsageLimitError without retry-after omits reset hint', () => {
  const error = makeGoError(
    JSON.stringify({
      error: {
        type: 'GoUsageLimitError',
        limitName: 'rolling',
        workspace: 'default',
      },
    }),
  )
  const text = getFirstText(getAssistantMessageFromError(error, 'glm-4.6'))

  expect(text).toContain(OPENCODE_GO_USAGE_LIMIT_ERROR_MESSAGE)
  expect(text).not.toContain('Resets in')
  // default workspace is not surfaced to reduce noise
  expect(text).not.toContain('Workspace:')
})

test('GoUsageLimitError reset duration formats hours and minutes', () => {
  const error = makeGoError(
    JSON.stringify({
      error: { type: 'GoUsageLimitError', limitName: 'daily', workspace: 'default' },
    }),
    { 'retry-after': '7560' }, // 2h 6m
  )
  const text = getFirstText(getAssistantMessageFromError(error, 'glm-4.6'))
  expect(text).toContain('Resets in 2h 6m')
})

test('falls back to OPENAI_BASE_URL env check when header is missing', () => {
  process.env.OPENAI_BASE_URL = 'https://opencode.ai/zen/go/v1'
  const error = APIError.generate(
    429,
    undefined,
    JSON.stringify({
      error: { type: 'FreeUsageLimitError', message: 'free exhausted' },
    }),
    new Headers(),
  )
  const text = getFirstText(getAssistantMessageFromError(error, 'glm-4.6'))
  expect(text).toBe(OPENCODE_GO_FREE_LIMIT_ERROR_MESSAGE)
})

test('non-opencode-go 429 with similar body is NOT mapped to opencode-go message', () => {
  // Same error body shape but no opencode.ai/zen/go URL anywhere
  const savedBaseUrl = process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_BASE_URL
  try {
    const error = APIError.generate(
      429,
      undefined,
      JSON.stringify({
        error: { type: 'FreeUsageLimitError', message: 'free exhausted' },
      }),
      new Headers({ 'x-opencode-request-url': 'https://api.openai.com/v1/messages' }),
    )
    const text = getFirstText(getAssistantMessageFromError(error, 'glm-4.6'))
    expect(text).not.toContain('OpenCode Go')
  } finally {
    if (savedBaseUrl !== undefined) {
      process.env.OPENAI_BASE_URL = savedBaseUrl
    }
  }
})

test('classifyAPIError returns opencode_go_quota_exhausted for GoUsageLimitError', () => {
  const error = makeGoError(
    JSON.stringify({ error: { type: 'GoUsageLimitError' } }),
  )
  expect(classifyAPIError(error)).toBe('opencode_go_quota_exhausted')
})

test('classifyAPIError returns opencode_go_quota_exhausted for FreeUsageLimitError', () => {
  const error = makeGoError(
    JSON.stringify({ error: { type: 'FreeUsageLimitError' } }),
  )
  expect(classifyAPIError(error)).toBe('opencode_go_quota_exhausted')
})

test('classifyAPIError returns rate_limit for generic opencode-go 429', () => {
  const error = makeGoError(JSON.stringify({ error: { message: 'slow down' } }))
  expect(classifyAPIError(error)).toBe('rate_limit')
})

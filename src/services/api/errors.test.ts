import { expect, test } from 'bun:test'

import { createAssistantAPIErrorMessage } from '../../utils/messages.js'

import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  isContextOverflowMessage,
  isPromptTooLongMessage,
} from './errors.js'

test('isContextOverflowMessage matches Anthropic prompt-too-long messages', () => {
  const msg = createAssistantAPIErrorMessage({
    content: PROMPT_TOO_LONG_ERROR_MESSAGE,
    apiError: 'context_overflow',
    error: 'invalid_request',
    errorDetails: 'prompt is too long: 200000 tokens > 199000 maximum',
  })

  expect(isContextOverflowMessage(msg)).toBe(true)
  // Still recognized by the legacy helper so the existing reactiveCompact
  // path keeps catching the same message in internal builds.
  expect(isPromptTooLongMessage(msg)).toBe(true)
})

test('isContextOverflowMessage matches OpenAI-shim context_overflow messages (Codex / GPT-5.5)', () => {
  const msg = createAssistantAPIErrorMessage({
    content:
      'The conversation exceeded the provider context limit. Run /compact or start a new session with /new.',
    apiError: 'context_overflow',
    error: 'invalid_request',
  })

  expect(isContextOverflowMessage(msg)).toBe(true)
  // Not surfaced as Anthropic PTL — verifies the new helper widens detection
  // beyond the prompt-too-long path so the OpenAI-shim case gets recovery too.
  expect(isPromptTooLongMessage(msg)).toBe(false)
})

test('isContextOverflowMessage matches Anthropic 500-context-overflow messages', () => {
  const msg = createAssistantAPIErrorMessage({
    content:
      'The conversation has grown too large for the API to process. Press esc twice to go up a few messages, or run /compact to reduce context. Alternatively, start a new session with /new.',
    apiError: 'context_overflow',
    error: 'invalid_request',
    errorDetails: 'Context overflow (500): too many tokens in request',
  })

  expect(isContextOverflowMessage(msg)).toBe(true)
})

test('isContextOverflowMessage falls back to content fingerprints if apiError tag missing', () => {
  // Older sites that emit the same content text without the apiError tag must
  // still be recognised — the content prefix list is the secondary signal.
  const msg = createAssistantAPIErrorMessage({
    content:
      'The conversation has grown too large for the API to process. Run /compact.',
    error: 'invalid_request',
  })

  expect(isContextOverflowMessage(msg)).toBe(true)
})

test('isContextOverflowMessage rejects unrelated API errors', () => {
  const rateLimitMsg = createAssistantAPIErrorMessage({
    content: 'API Error: Provider rate limit reached. Retry in a few seconds.',
    error: 'rate_limit',
  })
  expect(isContextOverflowMessage(rateLimitMsg)).toBe(false)

  const authMsg = createAssistantAPIErrorMessage({
    content: 'API Error: Authentication failed.',
    error: 'authentication_failed',
  })
  expect(isContextOverflowMessage(authMsg)).toBe(false)
})

test('isContextOverflowMessage rejects non-error assistant messages', () => {
  // Synthetic message with the content text but isApiErrorMessage=false must
  // not be classified — guard against assistant text accidentally tripping
  // the loop's recovery path.
  const baseMsg = createAssistantAPIErrorMessage({
    content: 'The conversation has grown too large for the API to process.',
    error: 'invalid_request',
  })
  const nonErrorMsg = { ...baseMsg, isApiErrorMessage: false } as typeof baseMsg

  expect(isContextOverflowMessage(nonErrorMsg)).toBe(false)
})

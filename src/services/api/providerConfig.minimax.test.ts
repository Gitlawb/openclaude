import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_MODEL,
  resolveProviderRequest,
} from './providerConfig.js'

const originalEnv = {
  CLAUDE_CODE_USE_MINIMAX: process.env.CLAUDE_CODE_USE_MINIMAX,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

beforeEach(() => {
  delete process.env.CLAUDE_CODE_USE_MINIMAX
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL
})

afterEach(() => {
  process.env.CLAUDE_CODE_USE_MINIMAX = originalEnv.CLAUDE_CODE_USE_MINIMAX
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
})

test('uses MiniMax base URL by default when CLAUDE_CODE_USE_MINIMAX is set', () => {
  process.env.CLAUDE_CODE_USE_MINIMAX = '1'

  const result = resolveProviderRequest()

  expect(result.baseUrl).toBe(DEFAULT_MINIMAX_BASE_URL)
  expect(result.transport).toBe('chat_completions')
})

test('uses MiniMax-M2.7 as default model when CLAUDE_CODE_USE_MINIMAX is set', () => {
  process.env.CLAUDE_CODE_USE_MINIMAX = '1'

  const result = resolveProviderRequest()

  expect(result.resolvedModel).toBe(DEFAULT_MINIMAX_MODEL)
  expect(result.requestedModel).toBe(DEFAULT_MINIMAX_MODEL)
})

test('respects OPENAI_MODEL override when CLAUDE_CODE_USE_MINIMAX is set', () => {
  process.env.CLAUDE_CODE_USE_MINIMAX = '1'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7-highspeed'

  const result = resolveProviderRequest()

  expect(result.resolvedModel).toBe('MiniMax-M2.7-highspeed')
  expect(result.requestedModel).toBe('MiniMax-M2.7-highspeed')
})

test('respects OPENAI_BASE_URL override when CLAUDE_CODE_USE_MINIMAX is set', () => {
  process.env.CLAUDE_CODE_USE_MINIMAX = '1'
  process.env.OPENAI_BASE_URL = 'https://custom.minimax.example.com/v1'

  const result = resolveProviderRequest()

  expect(result.baseUrl).toBe('https://custom.minimax.example.com/v1')
})

test('DEFAULT_MINIMAX_BASE_URL points to api.minimax.io', () => {
  expect(DEFAULT_MINIMAX_BASE_URL).toBe('https://api.minimax.io/v1')
})

test('DEFAULT_MINIMAX_MODEL is MiniMax-M2.7', () => {
  expect(DEFAULT_MINIMAX_MODEL).toBe('MiniMax-M2.7')
})

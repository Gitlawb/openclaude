import { afterEach, expect, test } from 'bun:test'

import { getMaxOutputTokensForModel } from '../services/api/claude.ts'
import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from './context.ts'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

afterEach(() => {
  if (originalEnv.CLAUDE_CODE_USE_OPENAI === undefined) {
    delete process.env.CLAUDE_CODE_USE_OPENAI
  } else {
    process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  }
  if (originalEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS === undefined) {
    delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  } else {
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS =
      originalEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  }
  if (originalEnv.OPENAI_MODEL === undefined) {
    delete process.env.OPENAI_MODEL
  } else {
    process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
  }
})

test('deepseek-chat uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('deepseek-chat')).toBe(128_000)
  expect(getModelMaxOutputTokens('deepseek-chat')).toEqual({
    default: 8_192,
    upperLimit: 8_192,
  })
  expect(getMaxOutputTokensForModel('deepseek-chat')).toBe(8_192)
})

test('deepseek-chat clamps oversized max output overrides to the provider limit', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '32000'
  delete process.env.OPENAI_MODEL

  expect(getMaxOutputTokensForModel('deepseek-chat')).toBe(8_192)
})

test('gpt-4o uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('gpt-4o')).toBe(128_000)
  expect(getModelMaxOutputTokens('gpt-4o')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
  expect(getMaxOutputTokensForModel('gpt-4o')).toBe(16_384)
})

test('gpt-4o clamps oversized max output overrides to the provider limit', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '32000'
  delete process.env.OPENAI_MODEL

  expect(getMaxOutputTokensForModel('gpt-4o')).toBe(16_384)
})

test('gpt-5.4 family uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('gpt-5.4')).toBe(1_050_000)
  expect(getModelMaxOutputTokens('gpt-5.4')).toEqual({
    default: 128_000,
    upperLimit: 128_000,
  })

  expect(getContextWindowForModel('gpt-5.4-mini')).toBe(400_000)
  expect(getModelMaxOutputTokens('gpt-5.4-mini')).toEqual({
    default: 128_000,
    upperLimit: 128_000,
  })

  expect(getContextWindowForModel('gpt-5.4-nano')).toBe(400_000)
  expect(getModelMaxOutputTokens('gpt-5.4-nano')).toEqual({
    default: 128_000,
    upperLimit: 128_000,
  })
})

test('gpt-5.4 family keeps large max output overrides within provider limits', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '200000'

  expect(getMaxOutputTokensForModel('gpt-5.4')).toBe(128_000)
  expect(getMaxOutputTokensForModel('gpt-5.4-mini')).toBe(128_000)
  expect(getMaxOutputTokensForModel('gpt-5.4-nano')).toBe(128_000)
})

test('MiniMax-M2.7 uses explicit provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('MiniMax-M2.7')).toBe(204_800)
  expect(getModelMaxOutputTokens('MiniMax-M2.7')).toEqual({
    default: 131_072,
    upperLimit: 131_072,
  })
  expect(getMaxOutputTokensForModel('MiniMax-M2.7')).toBe(131_072)
})

test('unknown openai-compatible models use the 128k fallback window (not 8k, see #635)', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('some-unknown-3p-model')).toBe(128_000)
})

test('MiniMax-M2.5 and M2.1 use explicit provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('MiniMax-M2.5')).toBe(204_800)
  expect(getContextWindowForModel('MiniMax-M2.5-highspeed')).toBe(204_800)
  expect(getContextWindowForModel('MiniMax-M2.1')).toBe(204_800)
  expect(getContextWindowForModel('MiniMax-M2.1-highspeed')).toBe(204_800)
  expect(getModelMaxOutputTokens('MiniMax-M2.5')).toEqual({
    default: 131_072,
    upperLimit: 131_072,
  })
})

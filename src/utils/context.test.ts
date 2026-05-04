import { afterEach, beforeEach, expect, test } from 'bun:test'

import { getMaxOutputTokensForModel } from '../services/api/claude.js'
import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
  calculateTokenBudget,
} from './context.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
  CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS:
    process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS,
  CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS:
    process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
}

beforeEach(() => {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
  delete process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
  delete process.env.MINIMAX_API_KEY
  delete process.env.XAI_API_KEY
})

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
  if (originalEnv.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS === undefined) {
    delete process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
  } else {
    process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS =
      originalEnv.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
  }
  if (originalEnv.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS === undefined) {
    delete process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
  } else {
    process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS =
      originalEnv.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
  }
  if (originalEnv.OPENAI_MODEL === undefined) {
    delete process.env.OPENAI_MODEL
  } else {
    process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
  }
  if (originalEnv.OPENAI_BASE_URL === undefined) {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  }
  if (originalEnv.OPENAI_API_BASE === undefined) {
    delete process.env.OPENAI_API_BASE
  } else {
    process.env.OPENAI_API_BASE = originalEnv.OPENAI_API_BASE
  }
  if (originalEnv.MINIMAX_API_KEY === undefined) {
    delete process.env.MINIMAX_API_KEY
  } else {
    process.env.MINIMAX_API_KEY = originalEnv.MINIMAX_API_KEY
  }
  if (originalEnv.XAI_API_KEY === undefined) {
    delete process.env.XAI_API_KEY
  } else {
    process.env.XAI_API_KEY = originalEnv.XAI_API_KEY
  }
})

test('deepseek-v4-flash uses the gateway-safe output cap by default', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('deepseek-v4-flash')).toBe(1_048_576)
  expect(getModelMaxOutputTokens('deepseek-v4-flash')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
  expect(getMaxOutputTokensForModel('deepseek-v4-flash')).toBe(65_536)
})

test('deepseek-v4-flash uses DeepSeek direct API max output cap on api.deepseek.com', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('deepseek-v4-flash')).toBe(1_048_576)
  expect(getModelMaxOutputTokens('deepseek-v4-flash')).toEqual({
    default: 393_216,
    upperLimit: 393_216,
  })
  expect(getMaxOutputTokensForModel('deepseek-v4-flash')).toBe(393_216)
})

test('deepseek-v4-pro uses the gateway-safe output cap by default', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_048_576)
  expect(getModelMaxOutputTokens('deepseek-v4-pro')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
  expect(getMaxOutputTokensForModel('deepseek-v4-pro')).toBe(65_536)
})

test('deepseek-v4-pro uses DeepSeek direct API max output cap on api.deepseek.com', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_048_576)
  expect(getModelMaxOutputTokens('deepseek-v4-pro')).toEqual({
    default: 393_216,
    upperLimit: 393_216,
  })
  expect(getMaxOutputTokensForModel('deepseek-v4-pro')).toBe(393_216)
})

test('deepseek-v4-pro keeps gateway routes on the lower output cap', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getModelMaxOutputTokens('deepseek-v4-pro')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
  expect(getMaxOutputTokensForModel('deepseek-v4-pro')).toBe(65_536)
})

test('deepseek legacy aliases keep their documented provider caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('deepseek-chat')).toBe(128_000)
  expect(getContextWindowForModel('deepseek-reasoner')).toBe(128_000)
  expect(getMaxOutputTokensForModel('deepseek-chat')).toBe(8_192)
  expect(getMaxOutputTokensForModel('deepseek-reasoner')).toBe(65_536)
})

test('deepseek-v4-pro clamps oversized max output overrides to the provider limit', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '500000'
  delete process.env.OPENAI_MODEL

  expect(getMaxOutputTokensForModel('deepseek-v4-pro')).toBe(65_536)
})

test('deepseek-v4-flash clamps oversized max output overrides to the provider limit', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '500000'
  delete process.env.OPENAI_MODEL

  expect(getMaxOutputTokensForModel('deepseek-v4-flash')).toBe(393_216)
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

test('env-only MiniMax key uses provider-specific context and output caps before client setup', () => {
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('MiniMax-M2.7')).toBe(204_800)
  expect(getModelMaxOutputTokens('MiniMax-M2.7')).toEqual({
    default: 131_072,
    upperLimit: 131_072,
  })
  expect(getMaxOutputTokensForModel('MiniMax-M2.7')).toBe(131_072)
})

test('env-only xAI key uses provider-specific context and output caps before client setup', () => {
  process.env.XAI_API_KEY = 'xai-test-key'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('grok-4')).toBe(2_000_000)
  expect(getModelMaxOutputTokens('grok-4')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
  expect(getMaxOutputTokensForModel('grok-4')).toBe(32_768)
})

test('unknown openai-compatible models use the 128k fallback window (not 8k, see #635)', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('some-unknown-3p-model')).toBe(128_000)
})

test('OpenAI-compatible custom model limits honor documented env overrides', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'custom-model': 262_144,
  })
  process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS = JSON.stringify({
    'custom-model': 12_288,
  })

  expect(getContextWindowForModel('custom-model')).toBe(262_144)
  expect(getModelMaxOutputTokens('custom-model')).toEqual({
    default: 12_288,
    upperLimit: 12_288,
  })
})

test('OpenAI-compatible env overrides take precedence over integration metadata', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'gpt-4o': 64_000,
  })
  process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS = JSON.stringify({
    'gpt-4o': 4_096,
  })

  expect(getContextWindowForModel('gpt-4o')).toBe(64_000)
  expect(getModelMaxOutputTokens('gpt-4o')).toEqual({
    default: 4_096,
    upperLimit: 4_096,
  })
})

test('OpenAI-compatible host-qualified env overrides beat generic overrides', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.foo.com/v1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'gpt-4o': 128_000,
    'api.foo.com:gpt-4o': 64_000,
  })
  process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS = JSON.stringify({
    'gpt-4o': 16_384,
    'api.foo.com:gpt-4o': 4_096,
  })

  expect(getContextWindowForModel('gpt-4o')).toBe(64_000)
  expect(getModelMaxOutputTokens('gpt-4o')).toEqual({
    default: 4_096,
    upperLimit: 4_096,
  })
})

test('OpenAI-compatible host-qualified env overrides honor OPENAI_API_BASE', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_API_BASE = 'https://legacy.foo.com/v1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'gpt-4o': 128_000,
    'legacy.foo.com:gpt-4o': 96_000,
  })
  process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS = JSON.stringify({
    'gpt-4o': 16_384,
    'legacy.foo.com:gpt-4o': 8_192,
  })

  expect(getContextWindowForModel('gpt-4o')).toBe(96_000)
  expect(getModelMaxOutputTokens('gpt-4o')).toEqual({
    default: 8_192,
    upperLimit: 8_192,
  })
})

test('OpenAI-compatible exact env overrides beat host-qualified prefixes', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.foo.com/v1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'api.foo.com:gpt-4': 8_192,
    'gpt-4o': 128_000,
  })
  process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS = JSON.stringify({
    'api.foo.com:gpt-4': 1_024,
    'gpt-4o': 16_384,
  })

  expect(getContextWindowForModel('gpt-4o')).toBe(128_000)
  expect(getModelMaxOutputTokens('gpt-4o')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
})

test('OpenAI-compatible legacy aliases keep their migrated limits', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('qwen2.5-coder:32b')).toBe(32_768)
  expect(getModelMaxOutputTokens('qwen2.5-coder:32b')).toEqual({
    default: 8_192,
    upperLimit: 8_192,
  })
  expect(getContextWindowForModel('deepseek-r1:14b')).toBe(65_536)
  expect(getModelMaxOutputTokens('deepseek-r1:14b')).toEqual({
    default: 8_192,
    upperLimit: 8_192,
  })
  expect(getContextWindowForModel('github:copilot')).toBe(128_000)
  expect(getModelMaxOutputTokens('github:copilot')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
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

test('DashScope qwen3.6-plus uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('qwen3.6-plus')).toBe(1_000_000)
  expect(getModelMaxOutputTokens('qwen3.6-plus')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
  expect(getMaxOutputTokensForModel('qwen3.6-plus')).toBe(65_536)
})

test('DashScope qwen3.5-plus uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('qwen3.5-plus')).toBe(1_000_000)
  expect(getModelMaxOutputTokens('qwen3.5-plus')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
  expect(getMaxOutputTokensForModel('qwen3.5-plus')).toBe(65_536)
})

test('DashScope qwen3-coder-plus uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('qwen3-coder-plus')).toBe(1_000_000)
  expect(getModelMaxOutputTokens('qwen3-coder-plus')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
})

test('DashScope qwen3-coder-next uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('qwen3-coder-next')).toBe(262_144)
  expect(getModelMaxOutputTokens('qwen3-coder-next')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
})

test('DashScope qwen3-max uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('qwen3-max')).toBe(262_144)
  expect(getModelMaxOutputTokens('qwen3-max')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
})

test('DashScope qwen3-max dated variant resolves to base entry via prefix match', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('qwen3-max-2026-01-23')).toBe(262_144)
  expect(getModelMaxOutputTokens('qwen3-max-2026-01-23')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
})

test('DashScope kimi-k2.5 uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('kimi-k2.5')).toBe(262_144)
  expect(getModelMaxOutputTokens('kimi-k2.5')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
})

test('Kimi Code kimi-for-coding uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('kimi-for-coding')).toBe(262_144)
  expect(getModelMaxOutputTokens('kimi-for-coding')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
})

test('DashScope glm-5 uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('glm-5')).toBe(202_752)
  expect(getModelMaxOutputTokens('glm-5')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
})

test('DashScope glm-4.7 uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('glm-4.7')).toBe(202_752)
  expect(getModelMaxOutputTokens('glm-4.7')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
})

test('calculateTokenBudget uses model output cap', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  
  const budget = calculateTokenBudget({
    model: 'deepseek-chat',
    systemPrompt: 'You are helpful',
    historyMessages: [{ message: { role: 'user', content: 'hello' } } as any],
  })

  expect(budget.reserved).toBeGreaterThan(0)
  expect(budget.available).toBeLessThan(budget.total)
})

test('calculateTokenBudget handles numeric history', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  
  const budget = calculateTokenBudget({
    model: 'gpt-4o',
    historyMessages: 10,
  })

  expect(budget.history).toBe(1000)
  expect(budget.available).toBeGreaterThan(0)
})

test('Z.AI uppercase GLM models use Coding Plan output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('GLM-5.1')).toBe(202_752)
  expect(getModelMaxOutputTokens('GLM-5.1')).toEqual({
    default: 131_072,
    upperLimit: 131_072,
  })
  expect(getModelMaxOutputTokens('GLM-5-Turbo')).toEqual({
    default: 131_072,
    upperLimit: 131_072,
  })
  expect(getModelMaxOutputTokens('GLM-4.5-Air')).toEqual({
    default: 65_536,
    upperLimit: 65_536,
  })
})

test('lowercase GLM aliases keep conservative output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getModelMaxOutputTokens('glm-5.1')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
  expect(getModelMaxOutputTokens('glm-5-turbo')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
  expect(getModelMaxOutputTokens('glm-4.5-air')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
})

test('DashScope models clamp oversized max output overrides to the provider limit', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '100000'

  expect(getMaxOutputTokensForModel('qwen3.6-plus')).toBe(65_536)
  expect(getMaxOutputTokensForModel('qwen3.5-plus')).toBe(65_536)
  expect(getMaxOutputTokensForModel('qwen3-coder-next')).toBe(65_536)
  expect(getMaxOutputTokensForModel('qwen3-max')).toBe(32_768)
  expect(getMaxOutputTokensForModel('kimi-k2.5')).toBe(32_768)
  expect(getMaxOutputTokensForModel('glm-5')).toBe(16_384)
  expect(getMaxOutputTokensForModel('glm-5.1')).toBe(16_384)
})

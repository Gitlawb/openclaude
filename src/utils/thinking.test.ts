import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { modelSupportsThinking } from './thinking.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'NVIDIA_NIM',
  'MINIMAX_API_KEY',
  'USER_TYPE',
]

const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
  // Ensure a clean slate for every test - disable all possible providers
  process.env.CLAUDE_CODE_USE_OPENAI = '0'
  process.env.CLAUDE_CODE_USE_GEMINI = '0'
  process.env.CLAUDE_CODE_USE_GITHUB = '0'
  process.env.CLAUDE_CODE_USE_MISTRAL = '0'
  process.env.CLAUDE_CODE_USE_BEDROCK = '0'
  process.env.CLAUDE_CODE_USE_VERTEX = '0'
  process.env.CLAUDE_CODE_USE_FOUNDRY = '0'
  process.env.NVIDIA_NIM = ''
  process.env.MINIMAX_API_KEY = ''
  process.env.XAI_API_KEY = ''
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

describe('modelSupportsThinking — Z.AI GLM', () => {
  test('enables thinking for exact GLM models on api.z.ai', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'

    expect(modelSupportsThinking('GLM-5.1')).toBe(true)
    expect(modelSupportsThinking('GLM-5-Turbo')).toBe(true)
    expect(modelSupportsThinking('GLM-4.7')).toBe(true)
    expect(modelSupportsThinking('GLM-4.5-Air')).toBe(true)
  })

  test('does not enable GLM thinking on non-Z.AI OpenAI-compatible endpoints', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

    expect(modelSupportsThinking('glm-5.1')).toBe(false)
    expect(modelSupportsThinking('GLM-5.1')).toBe(false)
  })

  test('does not match unrelated GLM-looking model names', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'

    expect(modelSupportsThinking('glm-50')).toBe(false)
  })
})
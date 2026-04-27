import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

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

async function importFreshThinkingModule() {
  // Avoid cross-file mock.module pollution and isolate this suite to the
  // Z.AI-specific path under the OpenAI provider.
  mock.restore()
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () =>
      process.env.CLAUDE_CODE_USE_OPENAI ? 'openai' : 'firstParty',
  }))
  mock.module('./model/modelSupportOverrides.js', () => ({
    get3PModelCapabilityOverride: () => undefined,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./thinking.js?ts=${nonce}`)
}

beforeEach(() => {
  mock.restore()
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
  mock.restore()
})

describe('modelSupportsThinking — Z.AI GLM', () => {
  test('enables thinking for exact GLM models on api.z.ai', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
    const { modelSupportsThinking } = await importFreshThinkingModule()

    expect(modelSupportsThinking('GLM-5.1')).toBe(true)
    expect(modelSupportsThinking('GLM-5-Turbo')).toBe(true)
    expect(modelSupportsThinking('GLM-4.7')).toBe(true)
    expect(modelSupportsThinking('GLM-4.5-Air')).toBe(true)
  })

  test('does not enable GLM thinking on non-Z.AI OpenAI-compatible endpoints', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    const { modelSupportsThinking } = await importFreshThinkingModule()

    expect(modelSupportsThinking('glm-5.1')).toBe(false)
    expect(modelSupportsThinking('GLM-5.1')).toBe(false)
  })

  test('does not match unrelated GLM-looking model names', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
    const { modelSupportsThinking } = await importFreshThinkingModule()

    expect(modelSupportsThinking('glm-50')).toBe(false)
  })
})
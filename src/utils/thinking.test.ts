import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as actualProviders from './model/providers.js'
import { resetSettingsCache } from './settings/settingsCache.js'

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
  'XAI_API_KEY',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'USER_TYPE',
]

const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
  resetSettingsCache()
})

afterEach(() => {
  mock.restore()
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
  resetSettingsCache()
})

async function importFreshThinkingModule(provider: ReturnType<typeof actualProviders.getAPIProvider> = 'openai') {
  mock.restore()
  mock.module('./model/providers.js', () => ({
    ...actualProviders,
    getAPIProvider: () => provider,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./thinking.js?ts=${nonce}`)
}

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

  test('does not reuse stale capability overrides after env changes', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'GLM-5.1'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = ''
    const { modelSupportsThinking } = await importFreshThinkingModule()

    expect(modelSupportsThinking('GLM-5.1')).toBe(false)

    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES
    process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'

    expect(modelSupportsThinking('GLM-5.1')).toBe(true)
  })
})

describe('modelSupportsThinking — Anthropic provider routes', () => {
  test('generic OpenAI-compatible routes do not inherit Anthropic Haiku thinking', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://custom.example/v1'
    const { modelSupportsThinking } = await importFreshThinkingModule('openai')

    expect(modelSupportsThinking('claude-haiku-4-5')).toBe(false)
  })

  test.each(['bedrock', 'vertex'] as const)(
    '%s keeps Haiku thinking disabled',
    async provider => {
      const { modelSupportsThinking } = await importFreshThinkingModule(provider)

      expect(modelSupportsThinking('claude-haiku-4-5')).toBe(false)
    },
  )

  test.each(['firstParty', 'foundry'] as const)(
    '%s keeps Haiku thinking enabled',
    async provider => {
      const { modelSupportsThinking } = await importFreshThinkingModule(provider)

      expect(modelSupportsThinking('claude-haiku-4-5')).toBe(true)
    },
  )
})

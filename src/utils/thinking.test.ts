import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
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
  'CLAUDE_CODE_DISABLE_THINKING',
  'USER_TYPE',
]

const originalEnv: Record<string, string | undefined> = {}

import {
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
  shouldUseThinkingForModel,
} from './thinking.js'

beforeEach(async () => {
  await acquireSharedMutationLock('utils/thinking.test.ts')
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
  resetSettingsCache()
})

afterEach(() => {
  try {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
    resetSettingsCache()
  } finally {
    releaseSharedMutationLock()
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
    expect(modelSupportsThinking('glm-5.3-flash')).toBe(true)
    expect(modelSupportsThinking('glm-5.3-flash?reasoning=low')).toBe(true)
    expect(modelSupportsThinking('glm-5.3-flash?reasoning=xhigh')).toBe(true)
    expect(modelSupportsThinking('glm-5.3')).toBe(true)
    expect(modelSupportsThinking('glm-5.3?reasoning=low')).toBe(true)
    expect(modelSupportsThinking('glm-5.2?thinking=disabled')).toBe(true)
    expect(modelSupportsThinking('glm-5.2 ?thinking=disabled')).toBe(true)
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

  test('does not reuse stale capability overrides after env changes', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'GLM-5.1'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = ''

    expect(modelSupportsThinking('GLM-5.1')).toBe(false)

    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES
    process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'

    expect(modelSupportsThinking('GLM-5.1')).toBe(true)
  })
})

describe('modelSupportsAdaptiveThinking — Claude 4 allowlist', () => {
  // Provider is set to OpenAI, so unknown Claude models default to false.
  // That makes the allowlist the only reason opus-4-8 returns true here, so
  // this test fails if opus-4-8 is dropped from the allowlist (#1769).
  test('includes Opus 4.8 in the adaptive-thinking allowlist', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'

    expect(modelSupportsAdaptiveThinking('claude-opus-4-8')).toBe(true)
    // 4.7 stays supported (guards against an accidental allowlist rewrite).
    expect(modelSupportsAdaptiveThinking('claude-opus-4-7')).toBe(true)
    // A non-allowlisted Claude 4 opus is still excluded on non-1P providers.
    expect(modelSupportsAdaptiveThinking('claude-opus-4-2')).toBe(false)
  })
})

describe('shouldUseThinkingForModel — Ollama', () => {
  test('does not use thinking for Ollama models when app-level thinking is enabled', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    const enabledThinking = { type: 'enabled' as const, budgetTokens: 1024 }

    expect(shouldUseThinkingForModel('llama3.1:8b', enabledThinking)).toBe(false)
    // Covers catalog-missing local names that would otherwise match Claude 4 heuristics.
    expect(shouldUseThinkingForModel('claude-sonnet-4-local', enabledThinking)).toBe(false)
  })
})

describe('Claude 5 provider thinking matrix — Bedrock vs Vertex', () => {
  const adaptiveConfig = { type: 'adaptive' as const }

  test('Bedrock enables thinking and adaptive thinking for Claude 5 routes', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'

    const bedrockModels = [
      'us.anthropic.claude-opus-5-v1:0',
      'us.anthropic.claude-sonnet-5-20260501-v1:0',
      'claude-opus-5',
      'claude-sonnet-5',
    ]

    for (const model of bedrockModels) {
      expect(modelSupportsThinking(model)).toBe(true)
      expect(modelSupportsAdaptiveThinking(model)).toBe(true)
      expect(shouldUseThinkingForModel(model, adaptiveConfig)).toBe(true)
    }
  })

  test('Vertex excludes Claude 5 models from thinking while keeping legacy Claude 4 enabled', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'

    const vertexClaude5Models = [
      'claude-opus-5@20260501',
      'claude-sonnet-5@20260501',
      'claude-opus-5',
      'claude-sonnet-5',
    ]

    for (const model of vertexClaude5Models) {
      expect(modelSupportsThinking(model)).toBe(false)
      expect(shouldUseThinkingForModel(model, adaptiveConfig)).toBe(false)
    }

    // Legacy Claude 4 models on Vertex remain eligible for thinking
    expect(modelSupportsThinking('claude-sonnet-4@20250514')).toBe(true)
    expect(modelSupportsThinking('claude-opus-4@20250514')).toBe(true)
  })

  test('1P and Foundry enable thinking and adaptive thinking for Claude 5', () => {
    for (const model of ['claude-opus-5', 'claude-sonnet-5']) {
      // 1P (no provider env set)
      expect(modelSupportsThinking(model)).toBe(true)
      expect(modelSupportsAdaptiveThinking(model)).toBe(true)
      expect(shouldUseThinkingForModel(model, adaptiveConfig)).toBe(true)
    }

    // Foundry
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    for (const model of ['claude-opus-5', 'claude-sonnet-5']) {
      expect(modelSupportsThinking(model)).toBe(true)
      expect(modelSupportsAdaptiveThinking(model)).toBe(true)
      expect(shouldUseThinkingForModel(model, adaptiveConfig)).toBe(true)
    }
  })
})

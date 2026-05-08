import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getModelCapabilities,
  getModelEffort,
  getModelLimits,
  getModelPricing,
} from './catalog.js'
import { getModelMaxOutputTokens, modelSupports1M } from '../../utils/context.js'
import {
  getAvailableEffortLevels,
  modelSupportsEffort,
  modelSupportsMaxEffort,
} from '../../utils/effort.js'
import { getModelPricingString, MODEL_COSTS } from '../../utils/modelCost.js'

const anthropicModels = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5',
]

const isolatedProviderEnvKeys = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'MINIMAX_API_KEY',
  'NVIDIA_NIM',
  'XAI_API_KEY',
  'USER_TYPE',
] as const

const originalProviderEnv = Object.fromEntries(
  isolatedProviderEnvKeys.map((key) => [key, process.env[key]]),
) as Record<typeof isolatedProviderEnvKeys[number], string | undefined>

function clearProviderEnv(): void {
  for (const key of isolatedProviderEnvKeys) {
    delete process.env[key]
  }
}

function restoreProviderEnv(): void {
  for (const key of isolatedProviderEnvKeys) {
    const value = originalProviderEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('model catalog parity', () => {
  beforeEach(() => {
    clearProviderEnv()
  })

  afterEach(() => {
    restoreProviderEnv()
  })

  test.each(anthropicModels)('%s output limits match context wrapper', (model) => {
    expect(getModelLimits(model, 'anthropic')?.maxOutputTokens).toEqual(
      getModelMaxOutputTokens(model),
    )
  })

  test('provider-prefixed Claude model strings resolve limits through catalog canonicalization', () => {
    expect(
      getModelMaxOutputTokens('us.anthropic.claude-opus-4-6-v1:0'),
    ).toEqual(getModelLimits('claude-opus-4-6', 'anthropic')?.maxOutputTokens)
  })

  test('legacy Sonnet 4 context upgrade support stays catalog-backed', () => {
    expect(modelSupports1M('claude-sonnet-4-5-20250929')).toBe(true)
    expect(modelSupports1M('us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe(
      true,
    )
  })

  test.each(anthropicModels)('%s effort support matches effort wrapper', (model) => {
    const effort = getModelEffort(model, 'anthropic')
    expect(Boolean(effort?.supported)).toBe(modelSupportsEffort(model))
    expect(effort?.levels ?? []).toEqual(getAvailableEffortLevels(model))
    expect(effort?.maxLevel === 'max').toBe(modelSupportsMaxEffort(model))
  })

  test('anthropic pricing exists for every legacy MODEL_COSTS key', () => {
    for (const [model, costs] of Object.entries(MODEL_COSTS)) {
      expect(getModelPricing(model, 'anthropic')).toMatchObject({
        input: costs.inputTokens,
        output: costs.outputTokens,
        cacheWrite: costs.promptCacheWriteTokens,
        cacheRead: costs.promptCacheReadTokens,
        webSearch: costs.webSearchRequests,
      })
      expect(getModelPricingString(model)).toBeDefined()
    }
  })

  test('codex spark remains without effort controls', () => {
    expect(getModelEffort('gpt-5.3-codex-spark', 'codex')?.supported).toBe(false)
    expect(getModelCapabilities('gpt-5.3-codex-spark', 'codex')?.reasoning).toBe(false)
  })

  test('OpenAI effort scheme exposes xhigh while standard persistence stays max', () => {
    expect(getModelEffort('gpt-5.4', 'codex')).toEqual({
      scheme: 'openai',
      supported: true,
      levels: ['low', 'medium', 'high', 'xhigh'],
      defaultLevel: 'high',
      maxLevel: 'xhigh',
    })
  })
})

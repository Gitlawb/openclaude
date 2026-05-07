import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { formatModelPricing, getModelCosts } from './modelCost.js'

type UsageWithSpeed = Usage & { speed?: 'fast' }

const isolatedProviderEnvKeys = [
  'CLAUDE_CODE_DISABLE_FAST_MODE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'NVIDIA_NIM',
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

beforeEach(() => {
  clearProviderEnv()
})

afterEach(() => {
  restoreProviderEnv()
})

function fastUsage(): UsageWithSpeed {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    speed: 'fast',
  } as UsageWithSpeed
}

test('catalog pricing keeps Opus 4.6 fast-mode variant', () => {
  expect(
    formatModelPricing(
      getModelCosts('claude-opus-4-6', fastUsage()),
    ),
  ).toBe('$30/$150 per Mtok')
})

test('catalog pricing keeps Opus 4.6 standard pricing when fast mode is disabled', () => {
  process.env.CLAUDE_CODE_DISABLE_FAST_MODE = '1'

  expect(
    formatModelPricing(
      getModelCosts('claude-opus-4-6', fastUsage()),
    ),
  ).toBe('$5/$25 per Mtok')
})

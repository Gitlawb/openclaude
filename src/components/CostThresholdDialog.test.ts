import { afterEach, beforeEach, expect, test } from 'bun:test'

import { getCostThresholdProviderLabel } from './CostThresholdDialog.js'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  restoreEnv()
})

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
  delete process.env.MINIMAX_API_KEY
  delete process.env.NVIDIA_NIM
  delete process.env.XAI_API_KEY
}

beforeEach(() => {
  clearProviderEnv()
})

test('getCostThresholdProviderLabel uses the active provider category for first-party sessions', () => {
  expect(getCostThresholdProviderLabel()).toBe('Anthropic API')
})

test('getCostThresholdProviderLabel keeps descriptor-era labels for mapped providers', () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  expect(getCostThresholdProviderLabel()).toBe('Gemini API')

  delete process.env.CLAUDE_CODE_USE_GEMINI
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  expect(getCostThresholdProviderLabel()).toBe('AWS Bedrock')
})

test('getCostThresholdProviderLabel falls back safely for unmapped provider categories', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = 'codexplan'

  expect(getCostThresholdProviderLabel()).toBe('API')
})

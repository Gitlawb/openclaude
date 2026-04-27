import { afterEach, expect, test } from 'bun:test'

import {
  DEFAULT_GITHUB_MODELS_API_MODEL,
  normalizeGithubCopilotModel,
  normalizeGithubModelsApiModel,
  resolveProviderRequest,
} from './providerConfig.js'

const originalUseGithub = process.env.CLAUDE_CODE_USE_GITHUB
const originalGithubModel = process.env.GITHUB_MODEL
const originalOpenaiModel = process.env.OPENAI_MODEL

afterEach(() => {
  if (originalUseGithub === undefined) {
    delete process.env.CLAUDE_CODE_USE_GITHUB
  } else {
    process.env.CLAUDE_CODE_USE_GITHUB = originalUseGithub
  }
  if (originalGithubModel === undefined) {
    delete process.env.GITHUB_MODEL
  } else {
    process.env.GITHUB_MODEL = originalGithubModel
  }
  if (originalOpenaiModel === undefined) {
    delete process.env.OPENAI_MODEL
  } else {
    process.env.OPENAI_MODEL = originalOpenaiModel
  }
})

test.each([
  ['copilot', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['github:copilot', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['auto', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['github:auto', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['github:gpt-4o', 'gpt-4o'],
  ['gpt-4o', 'gpt-4o'],
  ['github:copilot?reasoning=high', DEFAULT_GITHUB_MODELS_API_MODEL],
  // normalizeGithubModelsApiModel preserves provider prefix for models.github.ai compatibility
  ['github:openai/gpt-4.1', 'openai/gpt-4.1'],
  ['openai/gpt-4.1', 'openai/gpt-4.1'],
] as const)('normalizeGithubModelsApiModel(%s) -> %s', (input, expected) => {
  expect(normalizeGithubModelsApiModel(input)).toBe(expected)
})

// normalizeGithubCopilotModel maps 'copilot'/'auto'/empty to 'auto' for the 10% discount
test.each([
  ['copilot', 'auto'],
  ['github:copilot', 'auto'],
  ['', 'auto'],
  ['auto', 'auto'],
  ['github:auto', 'auto'],
  ['gpt-4o', 'gpt-4o'],
  ['github:gpt-4.1', 'gpt-4.1'],
  ['openai/gpt-4o', 'gpt-4o'],
] as const)('normalizeGithubCopilotModel(%s) -> %s', (input, expected) => {
  expect(normalizeGithubCopilotModel(input)).toBe(expected)
})

test('resolveProviderRequest applies GitHub normalization when CLAUDE_CODE_USE_GITHUB=1', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  const r = resolveProviderRequest({ model: 'github:gpt-4o' })
  expect(r.resolvedModel).toBe('gpt-4o')
  expect(r.transport).toBe('chat_completions')
})

test('resolveProviderRequest routes GitHub GPT-5 codex models to responses transport', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  const r = resolveProviderRequest({ model: 'gpt-5.3-codex' })
  expect(r.resolvedModel).toBe('gpt-5.3-codex')
  expect(r.transport).toBe('codex_responses')
})

test('resolveProviderRequest keeps gpt-5-mini on chat_completions for GitHub', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  const r = resolveProviderRequest({ model: 'gpt-5-mini' })
  expect(r.resolvedModel).toBe('gpt-5-mini')
  expect(r.transport).toBe('chat_completions')
})

test('resolveProviderRequest leaves model unchanged without GitHub flag', () => {
  delete process.env.CLAUDE_CODE_USE_GITHUB
  const r = resolveProviderRequest({ model: 'github:gpt-4o' })
  expect(r.resolvedModel).toBe('github:gpt-4o')
})

// GITHUB_MODEL env var tests
test('GITHUB_MODEL takes priority over OPENAI_MODEL', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.GITHUB_MODEL = 'gpt-4.1'
  process.env.OPENAI_MODEL = 'gpt-4o'
  const r = resolveProviderRequest()
  expect(r.resolvedModel).toBe('gpt-4.1')
})

test('OPENAI_MODEL works as fallback when GITHUB_MODEL is unset', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  delete process.env.GITHUB_MODEL
  process.env.OPENAI_MODEL = 'gpt-4.1'
  const r = resolveProviderRequest()
  expect(r.resolvedModel).toBe('gpt-4.1')
})

test('default model resolves to auto on Copilot API when no env vars set', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  delete process.env.GITHUB_MODEL
  delete process.env.OPENAI_MODEL
  const r = resolveProviderRequest()
  // Default 'github:copilot' on Copilot endpoint resolves to 'auto'
  expect(r.resolvedModel).toBe('auto')
})

test('resolveProviderRequest routes NEW models to Azure endpoint', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  const newModels = ['openai/gpt-4o', 'gpt-5-mini', 'gpt-5.3-codex', 'github:openai/o1']
  for (const model of newModels) {
    const r = resolveProviderRequest({ model })
    expect(r.baseUrl).toBe('https://models.inference.ai.azure.com/v1')
  }
})

test('resolveProviderRequest routes LEGACY models to Copilot endpoint', () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  const legacyModels = ['claude-3.5-sonnet', 'gpt-4o', 'github:copilot', 'auto']
  for (const model of legacyModels) {
    const r = resolveProviderRequest({ model })
    expect(r.baseUrl).toBe('https://api.githubcopilot.com')
  }
})


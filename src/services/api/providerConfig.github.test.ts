import { afterEach, expect, test } from 'bun:test'

import {
  DEFAULT_GITHUB_MODELS_API_MODEL,
  normalizeGithubModelsApiModel,
  resolveProviderRequest,
} from './providerConfig.js'

const originalUseGithub = process.env.CLAUDE_CODE_USE_GITHUB
const originalOpenAIApiFormat = process.env.OPENAI_API_FORMAT

afterEach(() => {
  if (originalUseGithub === undefined) {
    delete process.env.CLAUDE_CODE_USE_GITHUB
  } else {
    process.env.CLAUDE_CODE_USE_GITHUB = originalUseGithub
  }
  if (originalOpenAIApiFormat === undefined) {
    delete process.env.OPENAI_API_FORMAT
  } else {
    process.env.OPENAI_API_FORMAT = originalOpenAIApiFormat
  }
})

test.each([
  ['copilot', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['github:copilot', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['', DEFAULT_GITHUB_MODELS_API_MODEL],
  ['github:gpt-4o', 'gpt-4o'],
  ['gpt-4o', 'gpt-4o'],
  ['github:copilot?reasoning=high', DEFAULT_GITHUB_MODELS_API_MODEL],
  // normalizeGithubModelsApiModel preserves provider prefix for models.github.ai compatibility
  ['github:openai/gpt-4.1', 'openai/gpt-4.1'],
  ['openai/gpt-4.1', 'openai/gpt-4.1'],
] as const)('normalizeGithubModelsApiModel(%s) -> %s', (input, expected) => {
  expect(normalizeGithubModelsApiModel(input)).toBe(expected)
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

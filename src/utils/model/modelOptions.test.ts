import { afterEach, expect, test } from 'bun:test'

import { getModelOptions } from './modelOptions.js'

const originalEnv = {
  USER_TYPE: process.env.USER_TYPE,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

afterEach(() => {
  process.env.USER_TYPE = originalEnv.USER_TYPE
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.CLAUDE_CODE_USE_GEMINI = originalEnv.CLAUDE_CODE_USE_GEMINI
  process.env.CLAUDE_CODE_USE_GITHUB = originalEnv.CLAUDE_CODE_USE_GITHUB
  process.env.CLAUDE_CODE_USE_BEDROCK = originalEnv.CLAUDE_CODE_USE_BEDROCK
  process.env.CLAUDE_CODE_USE_VERTEX = originalEnv.CLAUDE_CODE_USE_VERTEX
  process.env.CLAUDE_CODE_USE_FOUNDRY = originalEnv.CLAUDE_CODE_USE_FOUNDRY
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
})

function resetToOpenAIProvider(model = 'gpt-4o'): void {
  delete process.env.USER_TYPE
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  process.env.OPENAI_MODEL = model
}

test('openai-compatible model options include Groq GPT-OSS entries', () => {
  resetToOpenAIProvider()

  const values = getModelOptions().map(option => option.value)

  expect(values).toContain('openai/gpt-oss-120b')
  expect(values).toContain('openai/gpt-oss-20b')
  expect(values).toContain('meta-llama/llama-4-maverick-17b-128e-instruct')
  expect(values).toContain('meta-llama/llama-4-scout-17b-16e-instruct')
})

test('codex model options follow expected descending flow', () => {
  resetToOpenAIProvider()

  const codexValues = getModelOptions()
    .map(option => option.value)
    .filter(
      (value): value is string =>
        typeof value === 'string' &&
        [
          'gpt-5.4',
          'gpt-5.4-mini',
          'gpt-5.3-codex',
          'gpt-5.3-codex-spark',
          'codexspark',
          'gpt-5.2-codex',
          'gpt-5.2',
          'gpt-5.1-codex-max',
          'gpt-5.1-codex-mini',
        ].includes(value),
    )

  expect(codexValues).toEqual([
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'codexspark',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
  ])
})

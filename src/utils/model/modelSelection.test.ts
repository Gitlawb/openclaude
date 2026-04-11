import { afterEach, expect, test } from 'bun:test'

import { setMainLoopModelOverride } from '../../bootstrap/state.js'
import { getUserSpecifiedModelSetting } from './model.js'

const originalEnv = {
  anthropicModel: process.env.ANTHROPIC_MODEL,
  geminiModel: process.env.GEMINI_MODEL,
  openaiModel: process.env.OPENAI_MODEL,
  useBedrock: process.env.CLAUDE_CODE_USE_BEDROCK,
  useFoundry: process.env.CLAUDE_CODE_USE_FOUNDRY,
  useGemini: process.env.CLAUDE_CODE_USE_GEMINI,
  useGithub: process.env.CLAUDE_CODE_USE_GITHUB,
  useOpenai: process.env.CLAUDE_CODE_USE_OPENAI,
  useVertex: process.env.CLAUDE_CODE_USE_VERTEX,
}

function restoreEnv(
  key:
    | 'ANTHROPIC_MODEL'
    | 'GEMINI_MODEL'
    | 'OPENAI_MODEL'
    | 'CLAUDE_CODE_USE_BEDROCK'
    | 'CLAUDE_CODE_USE_FOUNDRY'
    | 'CLAUDE_CODE_USE_GEMINI'
    | 'CLAUDE_CODE_USE_GITHUB'
    | 'CLAUDE_CODE_USE_OPENAI'
    | 'CLAUDE_CODE_USE_VERTEX',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function clearProviderAndModelEnv(): void {
  delete process.env.ANTHROPIC_MODEL
  delete process.env.GEMINI_MODEL
  delete process.env.OPENAI_MODEL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_VERTEX
}

afterEach(() => {
  setMainLoopModelOverride(undefined)
  restoreEnv('ANTHROPIC_MODEL', originalEnv.anthropicModel)
  restoreEnv('GEMINI_MODEL', originalEnv.geminiModel)
  restoreEnv('OPENAI_MODEL', originalEnv.openaiModel)
  restoreEnv('CLAUDE_CODE_USE_BEDROCK', originalEnv.useBedrock)
  restoreEnv('CLAUDE_CODE_USE_FOUNDRY', originalEnv.useFoundry)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.useGemini)
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.useGithub)
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.useOpenai)
  restoreEnv('CLAUDE_CODE_USE_VERTEX', originalEnv.useVertex)
})

test('getUserSpecifiedModelSetting prefers OPENAI_MODEL for openai provider over stale GEMINI_MODEL', () => {
  clearProviderAndModelEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'llama-3.3-70b-versatile'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash-exp'

  expect(getUserSpecifiedModelSetting()).toBe('llama-3.3-70b-versatile')
})

test('getUserSpecifiedModelSetting prefers GEMINI_MODEL for gemini provider over stale OPENAI_MODEL', () => {
  clearProviderAndModelEnv()
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_MODEL = 'gemini-2.5-flash'
  process.env.OPENAI_MODEL = 'gpt-4o'

  expect(getUserSpecifiedModelSetting()).toBe('gemini-2.5-flash')
})

test('getUserSpecifiedModelSetting prefers ANTHROPIC_MODEL for first-party provider over third-party model env vars', () => {
  clearProviderAndModelEnv()
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash-exp'
  process.env.OPENAI_MODEL = 'gpt-4o'

  expect(getUserSpecifiedModelSetting()).toBe('claude-sonnet-4-6')
})

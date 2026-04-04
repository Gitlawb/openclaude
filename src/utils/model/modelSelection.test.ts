import { afterEach, expect, test } from 'bun:test'

import { setMainLoopModelOverride } from '../../bootstrap/state.js'
import { getUserSpecifiedModelSetting } from './model.js'

const originalEnv = {
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
}

function restoreEnv(
  key: keyof typeof originalEnv,
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
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_OPENAI
}

afterEach(() => {
  setMainLoopModelOverride(undefined)
  restoreEnv('ANTHROPIC_MODEL', originalEnv.ANTHROPIC_MODEL)
  restoreEnv('GEMINI_MODEL', originalEnv.GEMINI_MODEL)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
})

test('openai provider ignores stale gemini model env when choosing the main loop model', () => {
  clearProviderAndModelEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'llama-3.3-70b-versatile'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash-exp'

  expect(getUserSpecifiedModelSetting()).toBe('llama-3.3-70b-versatile')
})

test('gemini provider ignores stale openai model env when choosing the main loop model', () => {
  clearProviderAndModelEnv()
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_MODEL = 'gemini-2.5-flash'
  process.env.OPENAI_MODEL = 'gpt-4o'

  expect(getUserSpecifiedModelSetting()).toBe('gemini-2.5-flash')
})

test('first-party provider ignores third-party model env vars', () => {
  clearProviderAndModelEnv()
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash-exp'
  process.env.OPENAI_MODEL = 'gpt-4o'

  expect(getUserSpecifiedModelSetting()).toBe('claude-sonnet-4-6')
})

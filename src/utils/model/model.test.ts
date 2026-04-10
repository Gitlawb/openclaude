import { afterEach, describe, expect, test } from 'bun:test'

import { getSmallFastModel } from './model.js'

// Snapshot relevant env vars so we can restore after each test
const originalEnv = {
  ANTHROPIC_SMALL_FAST_MODEL: process.env.ANTHROPIC_SMALL_FAST_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.ANTHROPIC_SMALL_FAST_MODEL
  delete process.env.OPENAI_MODEL
  delete process.env.GEMINI_MODEL
}

describe('getSmallFastModel', () => {
  describe('Anthropic (firstParty)', () => {
    test('returns Haiku model by default', () => {
      clearProviderEnv()
      const model = getSmallFastModel()
      // Haiku model names contain "haiku"
      expect(model.toLowerCase()).toContain('haiku')
    })

    test('ANTHROPIC_SMALL_FAST_MODEL overrides the default', () => {
      clearProviderEnv()
      process.env.ANTHROPIC_SMALL_FAST_MODEL = 'my-custom-model'
      expect(getSmallFastModel()).toBe('my-custom-model')
    })
  })

  describe('OpenAI provider', () => {
    test('always returns gpt-4o-mini regardless of OPENAI_MODEL', () => {
      clearProviderEnv()
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      // Even if the user's main model is an expensive one, the small/fast
      // model must be the cheap mini variant.
      process.env.OPENAI_MODEL = 'gpt-4.1'

      expect(getSmallFastModel()).toBe('gpt-4o-mini')
    })

    test('returns gpt-4o-mini even when OPENAI_MODEL is unset', () => {
      clearProviderEnv()
      process.env.CLAUDE_CODE_USE_OPENAI = '1'

      expect(getSmallFastModel()).toBe('gpt-4o-mini')
    })

    test('ANTHROPIC_SMALL_FAST_MODEL takes precedence over provider defaults', () => {
      clearProviderEnv()
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.ANTHROPIC_SMALL_FAST_MODEL = 'forced-override'

      expect(getSmallFastModel()).toBe('forced-override')
    })
  })

  describe('Gemini provider', () => {
    test('always returns gemini-2.0-flash-lite regardless of GEMINI_MODEL', () => {
      clearProviderEnv()
      process.env.CLAUDE_CODE_USE_GEMINI = '1'
      // Even if the user's main model is the expensive pro variant, compaction
      // must use the fast/cheap flash-lite model.
      process.env.GEMINI_MODEL = 'gemini-2.5-pro-preview'

      expect(getSmallFastModel()).toBe('gemini-2.0-flash-lite')
    })

    test('returns gemini-2.0-flash-lite even when GEMINI_MODEL is unset', () => {
      clearProviderEnv()
      process.env.CLAUDE_CODE_USE_GEMINI = '1'

      expect(getSmallFastModel()).toBe('gemini-2.0-flash-lite')
    })

    test('ANTHROPIC_SMALL_FAST_MODEL takes precedence over provider defaults', () => {
      clearProviderEnv()
      process.env.CLAUDE_CODE_USE_GEMINI = '1'
      process.env.ANTHROPIC_SMALL_FAST_MODEL = 'forced-override'

      expect(getSmallFastModel()).toBe('forced-override')
    })
  })
})

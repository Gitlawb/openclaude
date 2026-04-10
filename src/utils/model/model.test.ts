import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import { getDefaultHaikuModel, getSmallFastModel } from './model.js'

// ─────────────────────────────────────────────────────────────────────────────
// Settings mock — allows per-test control of modelTiers.small
// ─────────────────────────────────────────────────────────────────────────────
let _mockTiersSmall: string | undefined = undefined

mock.module('../settings/settings.js', () => ({
  getInitialSettings: () =>
    _mockTiersSmall ? { modelTiers: { small: _mockTiersSmall } } : {},
  getSettings_DEPRECATED: () => ({}),
}))

// Snapshot relevant env vars so we can restore after each test
const originalEnv = {
  CLAUDE_CODE_SMALL_FAST_MODEL: process.env.CLAUDE_CODE_SMALL_FAST_MODEL,
  CLAUDE_CODE_DEFAULT_SMALL_MODEL: process.env.CLAUDE_CODE_DEFAULT_SMALL_MODEL,
  ANTHROPIC_SMALL_FAST_MODEL: process.env.ANTHROPIC_SMALL_FAST_MODEL,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
}

function clearSmallModelEnv(): void {
  delete process.env.CLAUDE_CODE_SMALL_FAST_MODEL
  delete process.env.CLAUDE_CODE_DEFAULT_SMALL_MODEL
  delete process.env.ANTHROPIC_SMALL_FAST_MODEL
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  delete process.env.OPENAI_MODEL
  delete process.env.GEMINI_MODEL
  delete process.env.OLLAMA_BASE_URL
  delete process.env.OPENAI_BASE_URL
}

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GITHUB
}

beforeEach(() => {
  // Reset model strings cache so each test picks up the correct provider env
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  _mockTiersSmall = undefined
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetModelStringsForTestingOnly()
})

// ─────────────────────────────────────────────────────────────────────────────
// getSmallFastModel — used by compaction, away summaries, token estimation,
// agentic search, hooks, skill improvement, WebSearch, and more.
// ─────────────────────────────────────────────────────────────────────────────

describe('getSmallFastModel — env var override priority', () => {
  test('CLAUDE_CODE_SMALL_FAST_MODEL is the highest priority override', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_SMALL_FAST_MODEL = 'my-provider-agnostic-model'
    // Legacy var set too — new var should win
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'legacy-model'

    expect(getSmallFastModel()).toBe('my-provider-agnostic-model')
  })

  test('ANTHROPIC_SMALL_FAST_MODEL still works as a legacy fallback', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'legacy-migrated-from-claude-code'

    expect(getSmallFastModel()).toBe('legacy-migrated-from-claude-code')
  })

  test('overrides win on OpenAI provider', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.CLAUDE_CODE_SMALL_FAST_MODEL = 'forced-override'

    expect(getSmallFastModel()).toBe('forced-override')
  })

  test('overrides win on Gemini provider', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.CLAUDE_CODE_SMALL_FAST_MODEL = 'forced-override'

    expect(getSmallFastModel()).toBe('forced-override')
  })
})

describe('getSmallFastModel — provider defaults (no overrides)', () => {
  test('Anthropic firstParty returns a Haiku model', () => {
    clearProviderEnv()
    clearSmallModelEnv()

    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })

  test('OpenAI provider returns gpt-4o-mini even when OPENAI_MODEL is gpt-4.1', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4.1'

    expect(getSmallFastModel()).toBe('gpt-4o-mini')
  })

  test('Gemini provider returns flash-lite even when GEMINI_MODEL is pro-preview', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.GEMINI_MODEL = 'gemini-2.5-pro-preview'

    expect(getSmallFastModel()).toBe('gemini-2.0-flash-lite')
  })

  test('Bedrock provider returns a Haiku-family model', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'

    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })

  test('Vertex provider returns a Haiku-family model', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_VERTEX = '1'

    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })

  test('Foundry provider returns a Haiku-family model', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'

    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })
})

describe('getSmallFastModel — settings.modelTiers.small', () => {
  test('modelTiers.small is used when no env var override is set', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    _mockTiersSmall = 'gpt-4o-mini'

    expect(getSmallFastModel()).toBe('gpt-4o-mini')
  })

  test('env var CLAUDE_CODE_SMALL_FAST_MODEL beats modelTiers.small', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    _mockTiersSmall = 'settings-model'
    process.env.CLAUDE_CODE_SMALL_FAST_MODEL = 'env-override'

    expect(getSmallFastModel()).toBe('env-override')
  })

  test('ANTHROPIC_SMALL_FAST_MODEL beats modelTiers.small', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    _mockTiersSmall = 'settings-model'
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'legacy-env-override'

    expect(getSmallFastModel()).toBe('legacy-env-override')
  })

  test('falls back to provider default when modelTiers.small is unset', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    // _mockTiersSmall is undefined — no settings override
    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })

  test('works with Ollama model name via modelTiers.small', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_MODEL = 'llama3.3:70b'
    _mockTiersSmall = 'llama3.2:3b'

    expect(getSmallFastModel()).toBe('llama3.2:3b')
  })
})

describe('getSmallFastModel — never leaks main-loop model', () => {
  test.each([
    ['openai', 'CLAUDE_CODE_USE_OPENAI', 'OPENAI_MODEL', 'gpt-4.1'],
    ['gemini', 'CLAUDE_CODE_USE_GEMINI', 'GEMINI_MODEL', 'gemini-2.5-pro-preview'],
  ] as const)(
    '%s: expensive main model env var does not leak into small/fast',
    (_name, providerEnv, modelEnv, expensiveModel) => {
      clearProviderEnv()
      clearSmallModelEnv()
      process.env[providerEnv] = '1'
      process.env[modelEnv] = expensiveModel

      expect(getSmallFastModel()).not.toBe(expensiveModel)
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// getDefaultHaikuModel — the "small tier" model surfaced in the model picker
// and used by attachments, alias resolution, etc.
// ─────────────────────────────────────────────────────────────────────────────

describe('getDefaultHaikuModel — env var override priority', () => {
  test('CLAUDE_CODE_DEFAULT_SMALL_MODEL is the highest priority override', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_DEFAULT_SMALL_MODEL = 'llama3.2:3b'
    // Legacy var set too — new var should win
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'legacy-haiku'

    expect(getDefaultHaikuModel()).toBe('llama3.2:3b')
  })

  test('ANTHROPIC_DEFAULT_HAIKU_MODEL still works as a legacy fallback', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'my-enterprise-haiku'

    expect(getDefaultHaikuModel()).toBe('my-enterprise-haiku')
  })

  test('override works regardless of provider', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4.1'           // expensive main-loop model
    process.env.CLAUDE_CODE_DEFAULT_SMALL_MODEL = 'gpt-4o-mini'

    expect(getDefaultHaikuModel()).toBe('gpt-4o-mini')
  })
})

describe('getDefaultHaikuModel — provider defaults (no overrides)', () => {
  test('Anthropic firstParty returns a Haiku model', () => {
    clearProviderEnv()
    clearSmallModelEnv()

    expect(getDefaultHaikuModel().toLowerCase()).toContain('haiku')
  })

  test('OpenAI API provider returns gpt-4o-mini, not OPENAI_MODEL', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4.1'  // expensive main-loop — must not bleed in

    expect(getDefaultHaikuModel()).toBe('gpt-4o-mini')
  })

  test('Gemini provider returns flash-lite, not GEMINI_MODEL', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.GEMINI_MODEL = 'gemini-2.5-pro-preview'

    expect(getDefaultHaikuModel()).toBe('gemini-2.0-flash-lite')
  })

  test('Bedrock provider returns a Haiku-family model', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'

    expect(getDefaultHaikuModel().toLowerCase()).toContain('haiku')
  })
})

describe('getDefaultHaikuModel — settings.modelTiers.small', () => {
  test('modelTiers.small is used when no env var override is set', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    _mockTiersSmall = 'llama3.2:3b'

    expect(getDefaultHaikuModel()).toBe('llama3.2:3b')
  })

  test('CLAUDE_CODE_DEFAULT_SMALL_MODEL beats modelTiers.small', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    _mockTiersSmall = 'settings-model'
    process.env.CLAUDE_CODE_DEFAULT_SMALL_MODEL = 'env-override'

    expect(getDefaultHaikuModel()).toBe('env-override')
  })

  test('ANTHROPIC_DEFAULT_HAIKU_MODEL beats modelTiers.small', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    _mockTiersSmall = 'settings-model'
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'legacy-env-override'

    expect(getDefaultHaikuModel()).toBe('legacy-env-override')
  })

  test('falls back to provider default when modelTiers.small is unset', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    // _mockTiersSmall is undefined — no settings override
    expect(getDefaultHaikuModel().toLowerCase()).toContain('haiku')
  })

  test('modelTiers.small takes priority over Ollama auto-detection', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OPENAI_MODEL = 'llama3.3:70b'
    _mockTiersSmall = 'llama3.2:3b'

    expect(getDefaultHaikuModel()).toBe('llama3.2:3b')
  })
})

describe('getDefaultHaikuModel — Ollama path', () => {
  test('OLLAMA_BASE_URL triggers Ollama detection', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OPENAI_MODEL = 'llama3.3:70b'

    // Without a configured small model, Ollama falls back to OPENAI_MODEL
    // (callable locally) — NOT a hardcoded API model like gpt-4o-mini
    const model = getDefaultHaikuModel()
    expect(model).not.toBe('gpt-4o-mini')
  })

  test('CLAUDE_CODE_DEFAULT_SMALL_MODEL pins Ollama small model explicitly', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OPENAI_MODEL = 'llama3.3:70b'
    process.env.CLAUDE_CODE_DEFAULT_SMALL_MODEL = 'llama3.2:3b'

    expect(getDefaultHaikuModel()).toBe('llama3.2:3b')
  })

  test('port-11434 OPENAI_BASE_URL also triggers Ollama detection', () => {
    clearProviderEnv()
    clearSmallModelEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_MODEL = 'qwen2.5-coder:7b'

    // Ollama path — model should not be a hardcoded API provider string
    const model = getDefaultHaikuModel()
    expect(model).not.toBe('gpt-4o-mini')
    expect(model).not.toBe('gemini-2.0-flash-lite')
  })
})

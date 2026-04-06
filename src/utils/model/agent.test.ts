import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetSettingsCache, setSessionSettingsCache } from '../settings/settingsCache.js'
import { getAgentModel, getAgentModelOptions } from './agent.js'

const PARENT_MODEL = 'claude-sonnet-4-6'

const PROVIDER_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP',
] as const

const savedProviderEnv: Partial<Record<(typeof PROVIDER_ENV_KEYS)[number], string | undefined>> =
  {}

function snapshotEnv() {
  for (const key of PROVIDER_ENV_KEYS) {
    savedProviderEnv[key] = process.env[key]
    delete process.env[key]
  }
}

function restoreEnv() {
  for (const key of PROVIDER_ENV_KEYS) {
    const val = savedProviderEnv[key]
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
}

function allowAllModels() {
  // Inject settings with no availableModels → all models allowed
  setSessionSettingsCache({ settings: {}, errors: [] })
}

beforeEach(() => {
  allowAllModels()
  delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  snapshotEnv()
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  restoreEnv()
  resetSettingsCache()
})

describe('getAgentModel — CLAUDE_CODE_SUBAGENT_MODEL validation', () => {
  test('throws when CLAUDE_CODE_SUBAGENT_MODEL is empty string', () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = ''
    expect(() => getAgentModel(undefined, PARENT_MODEL)).toThrow(
      'CLAUDE_CODE_SUBAGENT_MODEL must not be empty or whitespace-only',
    )
  })

  test('throws when CLAUDE_CODE_SUBAGENT_MODEL is whitespace-only', () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = '   '
    expect(() => getAgentModel(undefined, PARENT_MODEL)).toThrow(
      'CLAUDE_CODE_SUBAGENT_MODEL must not be empty or whitespace-only',
    )
  })

  test('throws when CLAUDE_CODE_SUBAGENT_MODEL is "inherit"', () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'inherit'
    expect(() => getAgentModel(undefined, PARENT_MODEL)).toThrow(
      'CLAUDE_CODE_SUBAGENT_MODEL cannot be set to "inherit"',
    )
  })

  test('throws when CLAUDE_CODE_SUBAGENT_MODEL is "INHERIT" (case insensitive)', () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'INHERIT'
    expect(() => getAgentModel(undefined, PARENT_MODEL)).toThrow(
      'CLAUDE_CODE_SUBAGENT_MODEL cannot be set to "inherit"',
    )
  })

  test('resolves valid model alias set via CLAUDE_CODE_SUBAGENT_MODEL', () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku'
    const result = getAgentModel(undefined, PARENT_MODEL)
    // haiku resolves to the default haiku model
    expect(result).toContain('haiku')
  })
})

describe('getAgentModel — toolSpecifiedModel validation', () => {
  test('throws when toolSpecifiedModel is empty string', () => {
    expect(() => getAgentModel(undefined, PARENT_MODEL, '')).toThrow(
      'Model override must not be an empty or whitespace-only string',
    )
  })

  test('throws when toolSpecifiedModel is whitespace-only', () => {
    expect(() => getAgentModel(undefined, PARENT_MODEL, '   ')).toThrow(
      'Model override must not be an empty or whitespace-only string',
    )
  })

  test('throws when toolSpecifiedModel is "inherit"', () => {
    expect(() => getAgentModel(undefined, PARENT_MODEL, 'inherit')).toThrow(
      '"inherit" is not a valid model override',
    )
  })

  test('throws when toolSpecifiedModel is "INHERIT" (case insensitive)', () => {
    expect(() => getAgentModel(undefined, PARENT_MODEL, 'INHERIT')).toThrow(
      '"inherit" is not a valid model override',
    )
  })

  test('resolves toolSpecifiedModel "sonnet" to the default sonnet model', () => {
    const result = getAgentModel(undefined, PARENT_MODEL, 'sonnet')
    expect(result).toBe(PARENT_MODEL) // aliasMatchesParentTier → inherits parent
  })

  test('toolSpecifiedModel "opus" resolves to opus when parent is sonnet', () => {
    const result = getAgentModel(undefined, PARENT_MODEL, 'opus')
    expect(result).toContain('opus')
  })
})

describe('getAgentModel — agentModel whitespace normalization', () => {
  test('whitespace-only agentModel falls back to inherit → returns parent model', () => {
    const result = getAgentModel('   ', PARENT_MODEL)
    // whitespace normalized to undefined → 'inherit' → returns parentModel
    expect(result).toBe(PARENT_MODEL)
  })

  test('empty agentModel falls back to inherit → returns parent model', () => {
    const result = getAgentModel('', PARENT_MODEL)
    expect(result).toBe(PARENT_MODEL)
  })

  test('undefined agentModel falls back to inherit → returns parent model', () => {
    const result = getAgentModel(undefined, PARENT_MODEL)
    expect(result).toBe(PARENT_MODEL)
  })

  test('explicit "inherit" agentModel returns parent model', () => {
    const result = getAgentModel('inherit', PARENT_MODEL)
    expect(result).toBe(PARENT_MODEL)
  })
})

describe('getAgentModel — allowlist enforcement', () => {
  test('throws when resolved model is not in allowlist', () => {
    setSessionSettingsCache({ settings: { availableModels: ['opus'] }, errors: [] })
    expect(() => getAgentModel(undefined, PARENT_MODEL, 'haiku')).toThrow(
      "is not allowed by your organization's model policy",
    )
  })

  test('does not throw when resolved model matches allowlist', () => {
    setSessionSettingsCache({ settings: { availableModels: ['haiku'] }, errors: [] })
    expect(() => getAgentModel(undefined, PARENT_MODEL, 'haiku')).not.toThrow()
  })
})

describe('getAgentModel — [1m] suffix with non-first-party providers (regression)', () => {
  test('sonnet[1m] via OpenAI provider resolves to gpt-4o[1m] (invalid — should NOT produce [1m] on 3P)', () => {
    // Repro: CLAUDE_CODE_USE_OPENAI=1, OPENAI_MODEL=gpt-4o
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    resetSettingsCache()

    // getAgentModelOptions still surfaces sonnet[1m] as a picker option
    const options = getAgentModelOptions()
    expect(options.some(o => o.value === 'sonnet[1m]')).toBe(true)

    // But resolving sonnet[1m] through getAgentModel with an OpenAI parent
    // should NOT produce gpt-4o[1m] — the [1m] suffix is first-party only.
    // The expected behavior: sonnet[1m] falls through to the default sonnet
    // resolution which for OpenAI is gpt-4o (no [1m]).
    const result = getAgentModel('sonnet[1m]', 'gpt-4o')
    expect(result).not.toContain('[1m]')
    expect(result).toBe('gpt-4o')
  })

  test('opus[1m] via OpenAI provider resolves to gpt-4o[1m] (invalid — should NOT produce [1m] on 3P)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    resetSettingsCache()

    const options = getAgentModelOptions()
    expect(options.some(o => o.value === 'opus[1m]')).toBe(true)

    const result = getAgentModel('opus[1m]', 'gpt-4o')
    expect(result).not.toContain('[1m]')
    expect(result).toBe('gpt-4o')
  })

  test('sonnet[1m] via Gemini provider does not produce [1m] suffix', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.GEMINI_MODEL = 'gemini-2.0-flash'
    resetSettingsCache()

    const result = getAgentModel('sonnet[1m]', 'gemini-2.0-flash')
    expect(result).not.toContain('[1m]')
    expect(result).toBe('gemini-2.0-flash')
  })

  test('opus[1m] via Gemini provider does not produce [1m] suffix', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.GEMINI_MODEL = 'gemini-2.5-pro'
    resetSettingsCache()

    const result = getAgentModel('opus[1m]', 'gemini-2.5-pro')
    expect(result).not.toContain('[1m]')
  })

  test('first-party provider still supports [1m] suffix', () => {
    // No 3P env vars set → firstParty provider
    resetSettingsCache()

    const result = getAgentModel('sonnet[1m]', 'claude-sonnet-4-6')
    expect(result).toContain('[1m]')
  })
})

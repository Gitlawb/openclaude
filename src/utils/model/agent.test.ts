import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetSettingsCache, setSessionSettingsCache } from '../settings/settingsCache.js'
import { getAgentModel } from './agent.js'

const PARENT_MODEL = 'claude-sonnet-4-6'

function allowAllModels() {
  // Inject settings with no availableModels → all models allowed
  setSessionSettingsCache({ settings: {}, errors: [] })
}

beforeEach(() => {
  allowAllModels()
  delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
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

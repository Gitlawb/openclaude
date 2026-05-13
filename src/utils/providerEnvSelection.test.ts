import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { filterSettingsEnvForExplicitProvider } from './providerEnvSelection.js'

const originalEnv = { ...process.env }

const RESET_KEYS = [
  'CLAUDE_CODE_EXPLICIT_PROVIDER',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const

beforeEach(() => {
  for (const key of RESET_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of RESET_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

describe('filterSettingsEnvForExplicitProvider', () => {
  test('does not treat plain provider flags as an explicit CLI override', () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'

    expect(
      filterSettingsEnvForExplicitProvider({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_MODEL: 'gpt-4o',
        OTHER: 'keep-me',
      }),
    ).toEqual({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-4o',
      OTHER: 'keep-me',
    })
  })

  test('strips settings-sourced provider flags when CLI provider is explicit', () => {
    process.env.CLAUDE_CODE_EXPLICIT_PROVIDER = 'openai'

    expect(
      filterSettingsEnvForExplicitProvider({
        CLAUDE_CODE_USE_GITHUB: '1',
        CLAUDE_CODE_USE_OPENAI: '1',
        OTHER: 'keep-me',
      }),
    ).toEqual({ OTHER: 'keep-me' })
  })

  test('strips a stale GitHub model when explicit provider is not github', () => {
    process.env.CLAUDE_CODE_EXPLICIT_PROVIDER = 'openai'

    expect(
      filterSettingsEnvForExplicitProvider({
        OPENAI_MODEL: 'github:copilot',
        OTHER: 'keep-me',
      }),
    ).toEqual({ OTHER: 'keep-me' })
  })

  test('keeps a normal OpenAI model when explicit provider is openai', () => {
    process.env.CLAUDE_CODE_EXPLICIT_PROVIDER = 'openai'

    expect(
      filterSettingsEnvForExplicitProvider({
        OPENAI_MODEL: 'gpt-4o',
        OTHER: 'keep-me',
      }),
    ).toEqual({ OPENAI_MODEL: 'gpt-4o', OTHER: 'keep-me' })
  })

  test('strips a non-GitHub OpenAI model when explicit provider is github', () => {
    process.env.CLAUDE_CODE_EXPLICIT_PROVIDER = 'github'

    expect(
      filterSettingsEnvForExplicitProvider({
        OPENAI_MODEL: 'gpt-4o',
        OTHER: 'keep-me',
      }),
    ).toEqual({ OTHER: 'keep-me' })
  })

  test('preserves anthropic startup intent by stripping stale GitHub/OpenAI settings', () => {
    process.env.CLAUDE_CODE_EXPLICIT_PROVIDER = 'anthropic'

    expect(
      filterSettingsEnvForExplicitProvider({
        CLAUDE_CODE_USE_GITHUB: '1',
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_MODEL: 'github:copilot',
        OTHER: 'keep-me',
      }),
    ).toEqual({ OTHER: 'keep-me' })
  })

  test('preserves explicit ollama startup intent by stripping OpenAI routing settings', () => {
    process.env.CLAUDE_CODE_EXPLICIT_PROVIDER = 'ollama'

    expect(
      filterSettingsEnvForExplicitProvider({
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_MODEL: 'gpt-4o',
        OPENAI_API_KEY: 'sk-test',
        OTHER: 'keep-me',
      }),
    ).toEqual({ OTHER: 'keep-me' })
  })
})

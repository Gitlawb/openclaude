import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  parseProviderFlag,
  parseModelFlag,
  applyProviderFlag,
  applyProviderFlagFromArgs,
  applyModelFlagFromArgs,
  VALID_PROVIDERS,
} from './providerFlag.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'BNKR_API_KEY',
  'XAI_API_KEY',
  'MINIMAX_API_KEY',
  'VENICE_API_KEY',
  'MIMO_API_KEY',
  'MISTRAL_MODEL',
  'ANTHROPIC_MODEL',
]

const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

const RESET_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'BNKR_API_KEY',
  'XAI_API_KEY',
  'MINIMAX_API_KEY',
  'VENICE_API_KEY',
  'MIMO_API_KEY',
  'MISTRAL_MODEL',
  'ANTHROPIC_MODEL',
] as const

beforeEach(() => {
  for (const key of RESET_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

// --- parseProviderFlag ---

describe('parseProviderFlag', () => {
  test('returns provider name when --provider flag present', () => {
    expect(parseProviderFlag(['--provider', 'openai'])).toBe('openai')
  })

  test('returns provider name with --model alongside', () => {
    expect(parseProviderFlag(['--provider', 'gemini', '--model', 'gemini-2.0-flash'])).toBe('gemini')
  })

  test('returns null when --provider flag absent', () => {
    expect(parseProviderFlag(['--model', 'gpt-4o'])).toBeNull()
  })

  test('returns null for empty args', () => {
    expect(parseProviderFlag([])).toBeNull()
  })

  test('returns null when --provider has no value', () => {
    expect(parseProviderFlag(['--provider'])).toBeNull()
  })

  test('returns null when --provider value starts with --', () => {
    expect(parseProviderFlag(['--provider', '--model'])).toBeNull()
  })
})

// --- applyProviderFlag ---

describe('native Verboo provider enforcement', () => {
  test.each([...VALID_PROVIDERS, 'unknown'])('rejects %s without mutating routing or credentials', provider => {
    process.env.OPENAI_API_KEY = 'fixture-existing-key'
    process.env.OPENAI_BASE_URL = 'https://fixture.example/v1'
    const before = { ...process.env }
    expect(applyProviderFlag(provider, ['--model', 'external-model']).error).toContain('provider nativo Verboo')
    expect(process.env).toEqual(before)
  })

  test('argv rejects an external provider and leaves the selected model unchanged', () => {
    expect(applyProviderFlagFromArgs(['--provider', 'ollama', '--model', 'external-model'])?.error).toContain('provider nativo Verboo')
    expect(process.env.OPENAI_MODEL).toBeUndefined()
  })

  test('does nothing when --provider is absent', () => {
    expect(applyProviderFlagFromArgs(['--model', 'native-model'])).toBeUndefined()
  })
})

describe('parseModelFlag', () => {
  test('returns model value when --model is present', () => {
    expect(parseModelFlag(['--model', 'gpt-4o-mini'])).toBe('gpt-4o-mini')
  })

  test('returns null when --model is absent', () => {
    expect(parseModelFlag(['--provider', 'openai'])).toBeNull()
  })

  test('returns null when --model has no value', () => {
    expect(parseModelFlag(['--model'])).toBeNull()
  })

  test('returns null when --model value looks like another flag', () => {
    expect(parseModelFlag(['--model', '--provider'])).toBeNull()
  })
})

// --- applyModelFlagFromArgs (#808) ---

describe('applyModelFlagFromArgs', () => {
  test('is a no-op when --model is absent', () => {
    applyModelFlagFromArgs(['--ide'])
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.GEMINI_MODEL).toBeUndefined()
    expect(process.env.ANTHROPIC_MODEL).toBeUndefined()
  })

  test('is a no-op when --provider is also present (handled by applyProviderFlagFromArgs)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    applyModelFlagFromArgs(['--provider', 'openai', '--model', 'gpt-4o'])
    expect(process.env.OPENAI_MODEL).toBeUndefined()
  })

  test('sets OPENAI_MODEL when CLAUDE_CODE_USE_OPENAI is active', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    applyModelFlagFromArgs(['--model', 'gpt-4o-mini'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o-mini')
  })

  test('sets GEMINI_MODEL when CLAUDE_CODE_USE_GEMINI is active', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    applyModelFlagFromArgs(['--model', 'gemini-2.0-flash'])
    expect(process.env.GEMINI_MODEL).toBe('gemini-2.0-flash')
  })

  test('sets MISTRAL_MODEL when CLAUDE_CODE_USE_MISTRAL is active', () => {
    process.env.CLAUDE_CODE_USE_MISTRAL = '1'
    applyModelFlagFromArgs(['--model', 'devstral-latest'])
    expect(process.env.MISTRAL_MODEL).toBe('devstral-latest')
  })

  test('sets OPENAI_MODEL when CLAUDE_CODE_USE_GITHUB is active', () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    applyModelFlagFromArgs(['--model', 'gpt-4.1'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4.1')
  })

  test('falls back to ANTHROPIC_MODEL when no provider flag is set', () => {
    applyModelFlagFromArgs(['--model', 'claude-sonnet-4-6'])
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
  })

  test('overrides an existing *_MODEL value (saved profile override)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-4o'
    applyModelFlagFromArgs(['--model', 'gpt-4o-mini'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o-mini')
  })

  test('accepts --model value containing colons (ollama tag syntax)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    applyModelFlagFromArgs(['--model', 'qwen2.5-coder:14b'])
    expect(process.env.OPENAI_MODEL).toBe('qwen2.5-coder:14b')
  })
})

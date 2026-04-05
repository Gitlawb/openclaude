import { beforeEach, describe, expect, test, afterEach } from 'bun:test'
import {
  parseProviderFlag,
  applyProviderFlag,
  applyProviderFlagFromArgs,
  VALID_PROVIDERS,
} from './providerFlag.js'

const originalEnv = { ...process.env }
const TEST_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROQ',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
] as const

beforeEach(() => {
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of TEST_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
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

describe('applyProviderFlag - anthropic', () => {
  test('sets no env vars for anthropic (default)', () => {
    const result = applyProviderFlag('anthropic', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBeUndefined()
  })

  test('clears stale provider routing env when switching back to anthropic', () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    process.env.OPENAI_BASE_URL = 'https://models.github.ai/inference'
    process.env.OPENAI_API_KEY = 'stale-token'
    process.env.GROQ_API_KEY = 'gsk-stale'

    applyProviderFlag('anthropic', [])

    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.GROQ_API_KEY).toBeUndefined()
  })
})

describe('applyProviderFlag - openai', () => {
  test('sets CLAUDE_CODE_USE_OPENAI=1', () => {
    const result = applyProviderFlag('openai', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  })

  test('sets OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('openai', ['--model', 'gpt-4o'])
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
  })

  test('clears stale GitHub routing env before enabling OpenAI', () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_BASE_URL = 'https://models.github.ai/inference'
    process.env.OPENAI_API_KEY = 'github-token'
    process.env.GROQ_API_KEY = 'gsk-stale'

    applyProviderFlag('openai', ['--model', 'gpt-4o'])

    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.GROQ_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o')
  })
})

describe('applyProviderFlag - gemini', () => {
  test('sets CLAUDE_CODE_USE_GEMINI=1', () => {
    const result = applyProviderFlag('gemini', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBe('1')
  })

  test('sets GEMINI_MODEL when --model is provided', () => {
    applyProviderFlag('gemini', ['--model', 'gemini-2.0-flash'])
    expect(process.env.GEMINI_MODEL).toBe('gemini-2.0-flash')
  })
})

describe('applyProviderFlag - groq', () => {
  test('sets Groq OpenAI-compatible env vars', () => {
    const result = applyProviderFlag('groq', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.CLAUDE_CODE_USE_GROQ).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.groq.com/openai/v1')
  })

  test('sets OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('groq', ['--model', 'llama-3.3-70b-versatile'])
    expect(process.env.OPENAI_MODEL).toBe('llama-3.3-70b-versatile')
  })
})

describe('applyProviderFlag - github', () => {
  test('sets CLAUDE_CODE_USE_GITHUB=1', () => {
    const result = applyProviderFlag('github', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
  })

  test('clears stale Groq routing env before enabling GitHub', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.CLAUDE_CODE_USE_GROQ = '1'
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1'
    process.env.OPENAI_API_KEY = 'gsk-test'
    process.env.GROQ_API_KEY = 'gsk-test'
    process.env.OPENAI_MODEL = 'llama-3.3-70b-versatile'

    applyProviderFlag('github', ['--model', 'github:copilot'])

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GROQ).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    expect(process.env.GROQ_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBe('github:copilot')
  })
})

describe('applyProviderFlag - bedrock', () => {
  test('sets CLAUDE_CODE_USE_BEDROCK=1', () => {
    const result = applyProviderFlag('bedrock', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
  })
})

describe('applyProviderFlag - vertex', () => {
  test('sets CLAUDE_CODE_USE_VERTEX=1', () => {
    const result = applyProviderFlag('vertex', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_VERTEX).toBe('1')
  })
})

describe('applyProviderFlag - ollama', () => {
  test('sets CLAUDE_CODE_USE_OPENAI=1 with Ollama base URL', () => {
    const result = applyProviderFlag('ollama', [])
    expect(result.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1')
    expect(process.env.OPENAI_API_KEY).toBe('ollama')
  })

  test('sets OPENAI_MODEL when --model is provided', () => {
    applyProviderFlag('ollama', ['--model', 'llama3.2'])
    expect(process.env.OPENAI_MODEL).toBe('llama3.2')
  })

  test('resets Ollama base URL to the default local endpoint', () => {
    process.env.OPENAI_BASE_URL = 'http://my-ollama:11434/v1'
    applyProviderFlag('ollama', [])
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1')
  })
})

describe('applyProviderFlag - invalid provider', () => {
  test('returns error for unknown provider', () => {
    const result = applyProviderFlag('unknown-provider', [])
    expect(result.error).toContain('unknown-provider')
    expect(result.error).toContain(VALID_PROVIDERS.join(', '))
  })
})

describe('applyProviderFlagFromArgs', () => {
  test('applies ollama provider and model from argv in one step', () => {
    const result = applyProviderFlagFromArgs([
      '--provider',
      'ollama',
      '--model',
      'qwen2.5:3b',
    ])

    expect(result?.error).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1')
    expect(process.env.OPENAI_MODEL).toBe('qwen2.5:3b')
  })

  test('returns undefined when --provider is absent', () => {
    expect(applyProviderFlagFromArgs(['--model', 'gpt-4o'])).toBeUndefined()
  })
})

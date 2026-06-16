import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const ORIGINAL_ENV = { ...process.env }

// Env vars that influence provider/route resolution. Cleared before every test
// so assertions are deterministic regardless of the host shell environment.
const PROVIDER_ENV_VARS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'FIREWORKS_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_API_KEY',
  'NVIDIA_NIM',
]

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_VARS) {
    delete process.env[key]
  }
}

async function buildPropertiesWithProvider(provider: string): Promise<
  Array<{ label?: string; value: unknown }>
> {
  mock.restore()
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => true,
    isGithubNativeAnthropicMode: () => false,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  const { buildAPIProviderProperties } = await import(`./status.js?ts=${nonce}`)
  return buildAPIProviderProperties()
}

async function buildPropertiesWithRealProvider(): Promise<
  Array<{ label?: string; value: unknown }>
> {
  mock.restore()
  const nonce = `${Date.now()}-${Math.random()}`
  const { buildAPIProviderProperties } = await import(`./status.js?ts=${nonce}`)
  return buildAPIProviderProperties()
}

function findValue(
  properties: Array<{ label?: string; value: unknown }>,
  label: string,
): unknown {
  return properties.find(property => property.label === label)?.value
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/status.routes.test.ts')
  clearProviderEnv()
})

afterEach(() => {
  try {
    mock.restore()
    restoreEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

test('OpenAI route resolves to the OpenAI route label', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-4o'
  process.env.OPENAI_API_KEY = 'sk-test-openai-key'

  const properties = await buildPropertiesWithProvider('openai')
  expect(findValue(properties, 'Provider route')).toBe('OpenAI')
  expect(findValue(properties, 'Transport')).toBe('OpenAI-compatible API')
  expect(findValue(properties, 'Model')).toBe('gpt-4o')
  const credential = findValue(properties, 'Credential') as
    | string
    | undefined
  expect(credential).toContain('OPENAI_API_KEY')
  expect(credential).not.toContain('sk-test-openai-key')
})

test('Ollama route shows local route details', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  process.env.OPENAI_MODEL = 'llama3.2'

  const properties = await buildPropertiesWithProvider('openai')
  expect(findValue(properties, 'Provider route')).toBe('Ollama')
  expect(findValue(properties, 'Transport')).toBe('OpenAI-compatible API')
  expect(findValue(properties, 'Model')).toBe('llama3.2')
})

test('OpenRouter route shows its route label instead of OpenAI-compatible', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'anthropic/claude-sonnet-4.5'
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key'

  const properties = await buildPropertiesWithProvider('openai')
  expect(findValue(properties, 'Provider route')).toBe('OpenRouter')
  expect(findValue(properties, 'API provider')).toBeUndefined()
  const credential = findValue(properties, 'Credential') as
    | string
    | undefined
  expect(credential).toContain('OPENROUTER_API_KEY')
  expect(credential).not.toContain('sk-or-test-key')
})

test('OpenRouter route displays OPENAI_API_BASE when it selected the route', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_API_BASE = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'anthropic/claude-sonnet-4.5'
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key'

  const properties = await buildPropertiesWithRealProvider()
  expect(findValue(properties, 'Provider route')).toBe('OpenRouter')
  expect(findValue(properties, 'OpenAI base URL')).toBe(
    'https://openrouter.ai/api/v1',
  )
})

test('blank OPENAI_BASE_URL falls back to OPENAI_API_BASE for route display', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = '   '
  process.env.OPENAI_API_BASE = ' https://openrouter.ai/api/v1 '
  process.env.OPENAI_MODEL = 'anthropic/claude-sonnet-4.5'
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key'

  const properties = await buildPropertiesWithRealProvider()
  expect(findValue(properties, 'Provider route')).toBe('OpenRouter')
  expect(findValue(properties, 'OpenAI base URL')).toBe(
    'https://openrouter.ai/api/v1',
  )
})

test('Groq route shows its route label instead of OpenAI-compatible', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1'
  process.env.OPENAI_MODEL = 'llama-3.3-70b-versatile'
  process.env.GROQ_API_KEY = 'gsk_test-key'

  const properties = await buildPropertiesWithProvider('openai')
  expect(findValue(properties, 'Provider route')).toBe('Groq')
  expect(findValue(properties, 'API provider')).toBeUndefined()
  expect(
    (findValue(properties, 'Credential') as string | undefined)?.includes(
      'GROQ_API_KEY',
    ),
  ).toBe(true)
})

test('route-specific credential values are redacted from displayed fields', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1'
  process.env.OPENAI_MODEL = 'gsk-route-secret-value-123'
  process.env.GROQ_API_KEY = 'gsk-route-secret-value-123'

  const properties = await buildPropertiesWithRealProvider()
  const serialized = JSON.stringify(properties)
  expect(serialized).not.toContain('gsk-route-secret-value-123')
  expect(findValue(properties, 'Model')).toBe('gsk...123')
})

test('env-only Fireworks route displays descriptor defaults', async () => {
  process.env.FIREWORKS_API_KEY = 'fw-test-key'

  const properties = await buildPropertiesWithRealProvider()
  expect(findValue(properties, 'Provider route')).toBe('Fireworks AI')
  expect(findValue(properties, 'OpenAI base URL')).toBe(
    'https://api.fireworks.ai/inference/v1',
  )
  expect(findValue(properties, 'Model')).toBe(
    'accounts/fireworks/models/llama-v3p1-70b-instruct',
  )
  expect(findValue(properties, 'Credential')).toBe(
    'FIREWORKS_API_KEY configured',
  )
})

test('Gemini route remains clear', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_MODEL = 'gemini-2.0-flash'
  process.env.GEMINI_API_KEY = 'gem-test-key'

  const properties = await buildPropertiesWithProvider('gemini')
  expect(findValue(properties, 'API provider')).toBe('Google Gemini')
  // Gemini has a native transport; route-aware block does not override it.
  expect(findValue(properties, 'Provider route')).toBeUndefined()
  expect(findValue(properties, 'Model')).toBe('gemini-2.0-flash')
})

test('GitHub route remains clear', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_BASE_URL = 'https://models.inference.ai.azure.com'
  process.env.OPENAI_MODEL = 'gpt-4o'

  const properties = await buildPropertiesWithProvider('github')
  // GitHub has a dedicated bucket; route-aware block does not override it.
  expect(findValue(properties, 'API provider')).toBe('GitHub Models')
  expect(findValue(properties, 'Provider route')).toBeUndefined()
})

test('unknown custom route falls back gracefully', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://my-internal-proxy.example.com/v1'
  process.env.OPENAI_MODEL = 'internal-model'
  process.env.OPENAI_API_KEY = 'sk-internal-key'

  const properties = await buildPropertiesWithProvider('openai')
  // No known route -> legacy "OpenAI-compatible" bucket is preserved.
  expect(findValue(properties, 'API provider')).toBe('OpenAI-compatible')
  expect(findValue(properties, 'Provider route')).toBeUndefined()
  expect(findValue(properties, 'Model')).toBe('internal-model')
})

test('secrets are never leaked in status properties', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'anthropic/claude-sonnet-4.5'
  process.env.OPENROUTER_API_KEY = 'sk-or-SECRET-VALUE-123'
  process.env.OPENAI_API_KEY = 'sk-SECRET-VALUE-456'

  const properties = await buildPropertiesWithProvider('openai')
  const serialized = JSON.stringify(properties)
  expect(serialized).not.toContain('sk-or-SECRET-VALUE-123')
  expect(serialized).not.toContain('sk-SECRET-VALUE-456')
})

test('end-to-end: real getAPIProvider resolves OpenRouter without mocking', async () => {
  // Do NOT mock getAPIProvider. Verify the full chain: env -> getAPIProvider
  // collapses to 'openai' -> route resolution surfaces 'OpenRouter'.
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'anthropic/claude-sonnet-4.5'
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key'

  const properties = await buildPropertiesWithRealProvider()
  expect(findValue(properties, 'Provider route')).toBe('OpenRouter')
  expect(findValue(properties, 'API provider')).toBeUndefined()
  expect(findValue(properties, 'Transport')).toBe('OpenAI-compatible API')
})

test('credential summary lists only configured env vars when multiple are known', async () => {
  // OpenRouter knows OPENROUTER_API_KEY and OPENAI_API_KEY. Configure only one.
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'anthropic/claude-sonnet-4.5'
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key'
  // OPENAI_API_KEY intentionally left unset.

  const properties = await buildPropertiesWithProvider('openai')
  const credential = findValue(properties, 'Credential') as
    | string
    | undefined
  expect(credential).toContain('OPENROUTER_API_KEY')
  expect(credential).not.toContain('OPENAI_API_KEY')
})

test('route-aware label is omitted when no credential env var is configured', async () => {
  // Ollama is a local route with no required credential env var.
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  process.env.OPENAI_MODEL = 'llama3.2'

  const properties = await buildPropertiesWithProvider('openai')
  expect(findValue(properties, 'Provider route')).toBe('Ollama')
  expect(findValue(properties, 'Credential')).toBeUndefined()
})

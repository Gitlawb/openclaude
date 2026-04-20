import { afterEach, expect, test } from 'bun:test'

const originalEnv = {
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

afterEach(() => {
  process.env.CLAUDE_CODE_USE_GEMINI = originalEnv.CLAUDE_CODE_USE_GEMINI
  process.env.CLAUDE_CODE_USE_GITHUB = originalEnv.CLAUDE_CODE_USE_GITHUB
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.CLAUDE_CODE_USE_BEDROCK = originalEnv.CLAUDE_CODE_USE_BEDROCK
  process.env.CLAUDE_CODE_USE_VERTEX = originalEnv.CLAUDE_CODE_USE_VERTEX
  process.env.CLAUDE_CODE_USE_FOUNDRY = originalEnv.CLAUDE_CODE_USE_FOUNDRY
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_API_BASE = originalEnv.OPENAI_API_BASE
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
})

async function importFreshProvidersModule() {
  return import(`./providers.js?ts=${Date.now()}-${Math.random()}`)
}

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
}

test('first-party provider keeps Anthropic account setup flow enabled', () => {
  clearProviderEnv()
  return importFreshProvidersModule().then(
    ({ getAPIProvider, usesAnthropicAccountFlow }) => {
      expect(getAPIProvider()).toBe('firstParty')
      expect(usesAnthropicAccountFlow()).toBe(true)
    },
  )
})

test.each([
  ['CLAUDE_CODE_USE_OPENAI', 'openai'],
  ['CLAUDE_CODE_USE_GITHUB', 'github'],
  ['CLAUDE_CODE_USE_GEMINI', 'gemini'],
  ['CLAUDE_CODE_USE_BEDROCK', 'bedrock'],
  ['CLAUDE_CODE_USE_VERTEX', 'vertex'],
  ['CLAUDE_CODE_USE_FOUNDRY', 'foundry'],
] as const)(
  '%s disables Anthropic account setup flow',
  async (envKey, provider) => {
    clearProviderEnv()
    process.env[envKey] = '1'
    const { getAPIProvider, usesAnthropicAccountFlow } =
      await importFreshProvidersModule()

    expect(getAPIProvider()).toBe(provider)
    expect(usesAnthropicAccountFlow()).toBe(false)
  },
)

test('GEMINI takes precedence over GitHub when both are set', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  const { getAPIProvider } = await importFreshProvidersModule()

  expect(getAPIProvider()).toBe('gemini')
})

test('explicit local openai-compatible base URLs stay on the openai provider', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8080/v1'
  process.env.OPENAI_MODEL = 'gpt-5.4'

  const { getAPIProvider } = await importFreshProvidersModule()
  expect(getAPIProvider()).toBe('openai')
})

test('codex aliases still resolve to the codex provider without a non-codex base URL', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'codexplan'

  const { getAPIProvider } = await importFreshProvidersModule()
  expect(getAPIProvider()).toBe('codex')
})

test('official OpenAI base URLs now keep provider detection on openai for aliases', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.4'

  const { getAPIProvider } = await importFreshProvidersModule()
  expect(getAPIProvider()).toBe('openai')
})

// isGithubNativeAnthropicMode

test('isGithubNativeAnthropicMode: false when CLAUDE_CODE_USE_GITHUB is not set', async () => {
  clearProviderEnv()
  process.env.OPENAI_MODEL = 'claude-sonnet-4-5'
  const { isGithubNativeAnthropicMode } = await importFreshProvidersModule()
  expect(isGithubNativeAnthropicMode()).toBe(false)
})

test('isGithubNativeAnthropicMode: true for bare claude- model via OPENAI_MODEL', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'claude-sonnet-4-5'
  const { isGithubNativeAnthropicMode } = await importFreshProvidersModule()
  expect(isGithubNativeAnthropicMode()).toBe(true)
})

test('isGithubNativeAnthropicMode: true for github:copilot:claude- compound format', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'github:copilot:claude-sonnet-4'
  const { isGithubNativeAnthropicMode } = await importFreshProvidersModule()
  expect(isGithubNativeAnthropicMode()).toBe(true)
})

test('isGithubNativeAnthropicMode: true when resolvedModel is a claude- model', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'github:copilot'
  const { isGithubNativeAnthropicMode } = await importFreshProvidersModule()
  expect(isGithubNativeAnthropicMode('claude-haiku-4-5')).toBe(true)
})

test('isGithubNativeAnthropicMode: false for generic github:copilot alias', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'github:copilot'
  const { isGithubNativeAnthropicMode } = await importFreshProvidersModule()
  expect(isGithubNativeAnthropicMode()).toBe(false)
})

test('isGithubNativeAnthropicMode: false for non-Claude model', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'gpt-4o'
  const { isGithubNativeAnthropicMode } = await importFreshProvidersModule()
  expect(isGithubNativeAnthropicMode()).toBe(false)
})

test('isGithubNativeAnthropicMode: false for github:copilot:gpt- model', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'github:copilot:gpt-4o'
  const { isGithubNativeAnthropicMode } = await importFreshProvidersModule()
  expect(isGithubNativeAnthropicMode()).toBe(false)
})

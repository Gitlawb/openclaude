import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import { saveGlobalConfig } from '../config.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'

async function importFreshModelOptionsModule() {
  return importFreshModelOptionsModuleForProvider('github')
}

async function importFreshModelOptionsModuleForProvider(
  provider: 'github' | 'openai',
  setupMocks?: () => void,
) {
  mock.restore()
  mock.module('./providers.js', () => ({
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => false,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
  setupMocks?.()
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./modelOptions.js?ts=${nonce}`)
}

const originalEnv = {
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  ANTHROPIC_CUSTOM_MODEL_OPTION: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION,
}

function restoreEnvValue(
  key: keyof typeof originalEnv,
): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(() => {
  mock.restore()
  setSessionSettingsCache({ settings: {}, errors: [] })
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_BASE_URL
  delete process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  mock.restore()
  resetSettingsCache()
  restoreEnvValue('CLAUDE_CODE_USE_GITHUB')
  restoreEnvValue('CLAUDE_CODE_USE_OPENAI')
  restoreEnvValue('CLAUDE_CODE_USE_GEMINI')
  restoreEnvValue('CLAUDE_CODE_USE_BEDROCK')
  restoreEnvValue('CLAUDE_CODE_USE_VERTEX')
  restoreEnvValue('CLAUDE_CODE_USE_FOUNDRY')
  restoreEnvValue('OPENAI_MODEL')
  restoreEnvValue('OPENAI_BASE_URL')
  restoreEnvValue('ANTHROPIC_CUSTOM_MODEL_OPTION')
  saveGlobalConfig(current => ({
    ...current,
    additionalModelOptionsCache: [],
    additionalModelOptionsCacheScope: undefined,
    openaiAdditionalModelOptionsCache: [],
    openaiAdditionalModelOptionsCacheByProfile: {},
    providerProfiles: [],
    activeProviderProfileId: undefined,
  }))
  resetModelStringsForTestingOnly()
})

test('GitHub provider exposes default + all Copilot models in /model options', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY

  process.env.OPENAI_MODEL = 'gpt-4o'
  delete process.env.ANTHROPIC_CUSTOM_MODEL_OPTION

  const { getModelOptions } = await importFreshModelOptionsModule()
  const options = getModelOptions(false)
  const nonDefault = options.filter(
    (option: { value: unknown }) => option.value !== null,
  )

  expect(nonDefault.length).toBeGreaterThan(1)
  expect(nonDefault.some((o: { value: unknown }) => o.value === 'gpt-4o')).toBe(true)
  expect(nonDefault.some((o: { value: unknown }) => o.value === 'gpt-5.3-codex')).toBe(true)
})

test('GitHub provider preserves catalog source order in /model options', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'gpt-4o'

  const { getModelOptions } = await importFreshModelOptionsModule()
  const nonDefault = getModelOptions(false)
    .filter((option: { value: unknown }) => option.value !== null)
    .map((option: { value: unknown }) => option.value)

  expect(nonDefault.slice(0, 3)).toEqual([
    'gpt-5.5',
    'gpt-5.5-mini',
    'gpt-5.4',
  ])
})

test('Ollama provider exposes dynamically discovered local models', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  process.env.OPENAI_MODEL = 'llama3.1:8b'

  const { getModelOptions } = await importFreshModelOptionsModuleForProvider(
    'openai',
    () => {
      mock.module('./ollamaModels.js', () => ({
        isOllamaProvider: () => true,
        getCachedOllamaModelOptions: () => [
          {
            value: 'qwen2.5-coder:14b',
            label: 'qwen2.5-coder:14b',
            description: 'Ollama · 14B',
          },
        ],
      }))
    },
  )
  const values = getModelOptions(false).map(
    (option: { value: unknown }) => option.value,
  )

  expect(values).toContain('qwen2.5-coder:14b')
})

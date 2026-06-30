import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import { acquireEnvMutex, releaseEnvMutex } from '../../entrypoints/sdk/shared.js'
import { saveGlobalConfig } from '../config.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'

async function importFreshModelOptionsModule() {
  mock.restore()
  mock.module('./providers.js', () => ({
    getAPIProvider: () => 'openai',
    getAPIProviderForStatsig: () => 'openai',
    isFirstPartyAnthropicBaseUrl: () => false,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./modelOptions.js?ts=${nonce}`)
}

async function getOpenAIModelOptions() {
  const { getModelOptions } = await importFreshModelOptionsModule()
  return getModelOptions()
}
const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_FORMAT: process.env.OPENAI_API_FORMAT,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  ATLAS_CLOUD_API_KEY: process.env.ATLAS_CLOUD_API_KEY,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  CODEX_CREDENTIAL_SOURCE: process.env.CODEX_CREDENTIAL_SOURCE,
  CHATGPT_ACCOUNT_ID: process.env.CHATGPT_ACCOUNT_ID,
  CODEX_ACCOUNT_ID: process.env.CODEX_ACCOUNT_ID,
}

function restoreEnvValue(key: keyof typeof originalEnv): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  await acquireEnvMutex()
  mock.restore()
  setSessionSettingsCache({ settings: {}, errors: [] })
  for (const key of Object.keys(originalEnv) as (keyof typeof originalEnv)[]) {
    delete process.env[key]
  }
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  try {
    mock.restore()
    resetSettingsCache()
    for (const key of Object.keys(originalEnv) as (keyof typeof originalEnv)[]) {
      restoreEnvValue(key)
    }
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
  } finally {
    releaseEnvMutex()
  }
})

test('OpenRouter keeps static catalog entries and the active custom model', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'deepseek/deepseek-chat'
  process.env.OPENROUTER_API_KEY = 'sk-openrouter-test'

  const values = (await getOpenAIModelOptions()).map(option => option.value)

  expect(values).toContain('openai/gpt-5-mini')
  expect(values).toContain('deepseek/deepseek-chat')
})

test('OpenRouter active profile cache merges with the static route catalog', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'qwen/qwen3-32b'
  process.env.OPENROUTER_API_KEY = 'sk-openrouter-test'

  saveGlobalConfig(current => ({
    ...current,
    providerProfiles: [
      {
        id: 'openrouter-profile',
        name: 'OpenRouter',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'qwen/qwen3-32b',
      },
    ],
    activeProviderProfileId: 'openrouter-profile',
    openaiAdditionalModelOptionsCacheByProfile: {
      'openrouter-profile': [
        {
          value: 'qwen/qwen3-32b',
          label: 'Qwen3 32B',
          description: 'Provider: OpenRouter',
        },
      ],
    },
  }))

  const values = (await getOpenAIModelOptions()).map(option => option.value)

  expect(values).toContain('qwen/qwen3-32b')
  expect(values).toContain('openai/gpt-5-mini')
})

test('Atlas Cloud canonicalizes static catalog aliases without hiding the catalog', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.atlascloud.ai/v1'
  process.env.OPENAI_MODEL = 'claude-opus-4-8'
  process.env.ATLAS_CLOUD_API_KEY = 'sk-atlas-test'

  const values = (await getOpenAIModelOptions()).map(option => option.value)

  expect(values).toContain('anthropic/claude-opus-4.8')
  expect(values).toContain('deepseek-ai/deepseek-v4-pro')
  expect(values).toContain('xai/grok-build-0.1')
  expect(values).toContain('xai/grok-4.3')
  expect(values).not.toContain('claude-opus-4-8')
  expect(values).not.toContain('grok-code-fast-1')
  expect(values).not.toContain('grok-4')
})
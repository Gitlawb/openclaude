import { afterEach, beforeEach, expect, test } from 'bun:test'

import { acquireEnvMutex, releaseEnvMutex } from '../../entrypoints/sdk/shared.js'
import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import { saveGlobalConfig } from '../config.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
import {
  getCachedXiaomiMimoModelOptions,
  isXiaomiMimoProvider,
} from './xiaomi-mimoModels.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  MIMO_API_KEY: process.env.MIMO_API_KEY,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  VENICE_API_KEY: process.env.VENICE_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
  ANTHROPIC_CUSTOM_MODEL_OPTION: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION,
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
  setSessionSettingsCache({ settings: {}, errors: [] })
  for (const key of Object.keys(originalEnv) as (keyof typeof originalEnv)[]) {
    delete process.env[key]
  }
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  try {
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

test('Xiaomi MiMo provider exposes MiMo catalog models in /model options', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  process.env.MIMO_API_KEY = 'mimo-live-key'

  const options = getCachedXiaomiMimoModelOptions()
  const values = options.map(option => option.value)

  expect(isXiaomiMimoProvider()).toBe(true)
  expect(values).toContain('mimo-v2.5-pro')
  expect(values).toContain('mimo-v2-flash')
  expect(
    options.some(option => option.label === 'MiMo V2.5 Pro'),
  ).toBe(true)
})

test('Xiaomi MiMo provider does not activate for unrelated OpenAI-compatible mimo-prefixed models', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.example.com/v1'
  process.env.OPENAI_MODEL = 'mimo-custom'

  expect(isXiaomiMimoProvider()).toBe(false)
})

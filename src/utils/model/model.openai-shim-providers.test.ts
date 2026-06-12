import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { resetStateForTests } from '../../bootstrap/state.js'
import {
  type GlobalConfig,
  getGlobalConfig,
  saveGlobalConfig,
} from '../config.js'
import {
  clearPluginSettingsBase,
  resetSettingsCache,
} from '../settings/settingsCache.js'
async function importFreshModelModule() {
  mock.restore()
  mock.module('./providers.js', () => ({
    getAPIProvider: () => {
      if (process.env.NVIDIA_NIM) return 'nvidia-nim'
      if (process.env.MINIMAX_API_KEY) return 'minimax'
      if (process.env.MIMO_API_KEY) return 'xiaomi-mimo'
      if (process.env.CLAUDE_CODE_USE_GEMINI) return 'gemini'
      if (process.env.CLAUDE_CODE_USE_MISTRAL) return 'mistral'
      if (process.env.CLAUDE_CODE_USE_GITHUB) return 'github'
      if (process.env.CLAUDE_CODE_USE_OPENAI) {
        const baseUrl = process.env.OPENAI_BASE_URL ?? ''
        const model = process.env.OPENAI_MODEL ?? ''
        return baseUrl.includes('/backend-api/codex') || model.startsWith('codex')
          ? 'codex'
          : 'openai'
      }
      if (process.env.CLAUDE_CODE_USE_BEDROCK) return 'bedrock'
      if (process.env.CLAUDE_CODE_USE_VERTEX) return 'vertex'
      if (process.env.CLAUDE_CODE_USE_FOUNDRY) return 'foundry'
      return 'firstParty'
    },
  }))
  mock.module('./modelAllowlist.js', () => ({
    isModelAllowed: () => true,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./model.js?ts=${nonce}`)
}

async function restoreMockedModulesToActual(): Promise<void> {
  const nonce = `${Date.now()}-${Math.random()}`
  const [actualProviders, actualModelAllowlist] = await Promise.all([
    import(`./providers.js?restore=${nonce}`),
    import(`./modelAllowlist.js?restore=${nonce}`),
  ])
  mock.module('./providers.js', () => actualProviders)
  mock.module('src/utils/model/providers.js', () => actualProviders)
  mock.module('./modelAllowlist.js', () => actualModelAllowlist)
  mock.module('src/utils/model/modelAllowlist.js', () => actualModelAllowlist)
}

const SAVED_ENV = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  MIMO_API_KEY: process.env.MIMO_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  CHATGPT_ACCOUNT_ID: process.env.CHATGPT_ACCOUNT_ID,
  ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME,
  ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION:
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION,
  ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES:
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES,
  ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME:
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME,
  ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION,
  ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME:
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME,
  ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION:
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION,
  ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES:
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES,
}
// `model` is a legacy loose key not declared on GlobalConfig.
const savedModel = (getGlobalConfig() as GlobalConfig & Record<string, unknown>).model

function restoreEnv(key: keyof typeof SAVED_ENV): void {
  if (SAVED_ENV[key] === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = SAVED_ENV[key]
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('model/model.openai-shim-providers.test.ts')
  // Other test files (notably modelOptions.github.test.ts) install a
  // persistent mock.module for './providers.js' that overrides getAPIProvider
  // globally. Without mock.restore() here, those overrides bleed into this
  // suite and the provider-kind branches we're testing become unreachable.
  mock.restore()
  resetStateForTests()
  resetSettingsCache()
  clearPluginSettingsBase()
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.NVIDIA_NIM
  delete process.env.MINIMAX_API_KEY
  delete process.env.ANTHROPIC_MODEL
  delete process.env.MIMO_API_KEY
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_BASE_URL
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES
  saveGlobalConfig(current => ({
    ...current,
    model: undefined,
    availableModels: undefined,
  }))
})

afterEach(async () => {
  try {
    mock.restore()
    resetStateForTests()
    resetSettingsCache()
    clearPluginSettingsBase()
    await restoreMockedModulesToActual()
    for (const key of Object.keys(SAVED_ENV) as Array<keyof typeof SAVED_ENV>) {
      restoreEnv(key)
    }
    saveGlobalConfig(current => ({
      ...current,
      model: savedModel,
      availableModels: undefined,
    }))
  } finally {
    releaseSharedMutationLock()
  }
})

test('codex provider reads OPENAI_MODEL, not stale settings.model', async () => {
  // Regression: switching from Moonshot (settings.model='kimi-k2.6' persisted
  // from that session) to the Codex profile. Codex profile correctly sets
  // OPENAI_MODEL=codexplan + base URL to chatgpt.com/backend-api/codex.
  // getUserSpecifiedModelSetting previously ignored env for 'codex' provider
  // and returned settings.model='kimi-k2.6', causing Codex's API to reject
  // the request: "The 'kimi-k2.6' model is not supported when using Codex".
  saveGlobalConfig(current => ({ ...current, model: 'kimi-k2.6' }))
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = 'codexplan'
  process.env.CODEX_API_KEY = 'codex-test'
  process.env.CHATGPT_ACCOUNT_ID = 'acct_test'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('codexplan')
})

test('nvidia-nim provider reads OPENAI_MODEL, not stale settings.model', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'kimi-k2.6' }))
  process.env.NVIDIA_NIM = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test('minimax provider reads OPENAI_MODEL, not stale settings.model', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'kimi-k2.6' }))
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('MiniMax-M2.5')
})

test('xiaomi mimo provider reads OPENAI_MODEL, not stale settings.model', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'opus' }))
  process.env.MIMO_API_KEY = 'mimo-test'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('mimo-v2.5-pro')
})

test('openai provider still reads OPENAI_MODEL (regression guard)', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'stale-default' }))
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-4o'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('gpt-4o')
})

test('github provider still reads OPENAI_MODEL (regression guard)', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'stale-default' }))
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'github:copilot'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('github:copilot')
})

// ---------------------------------------------------------------------------
// Default model helpers — must not fall through to claude-haiku-4-5 etc. for
// OpenAI-shim providers whose endpoints don't speak Anthropic model names.
// Hitting that fallthrough caused WebFetch to hang for 60s on MiniMax/Codex
// because queryHaiku() shipped an unknown model id to the shim endpoint.
// ---------------------------------------------------------------------------

test('getSmallFastModel returns OPENAI_MODEL for MiniMax (regression: WebFetch hang)', async () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5-highspeed'

  const { getSmallFastModel } = await importFreshModelModule()
  expect(getSmallFastModel()).toBe('MiniMax-M2.5-highspeed')
})

test('getSmallFastModel returns OPENAI_MODEL for Codex (regression)', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = 'codexspark'
  process.env.CODEX_API_KEY = 'codex-test'
  process.env.CHATGPT_ACCOUNT_ID = 'acct_test'

  const { getSmallFastModel } = await importFreshModelModule()
  expect(getSmallFastModel()).toBe('codexspark')
})

test('getSmallFastModel returns OPENAI_MODEL for NVIDIA NIM (regression)', async () => {
  process.env.NVIDIA_NIM = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  const { getSmallFastModel } = await importFreshModelModule()
  expect(getSmallFastModel()).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test('getSmallFastModel returns OPENAI_MODEL for Xiaomi MiMo', async () => {
  process.env.MIMO_API_KEY = 'mimo-test'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2-flash'

  const { getSmallFastModel } = await importFreshModelModule()
  expect(getSmallFastModel()).toBe('mimo-v2-flash')
})

test('getDefaultOpusModel returns OPENAI_MODEL for MiniMax', async () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7'

  const { getDefaultOpusModel } = await importFreshModelModule()
  expect(getDefaultOpusModel()).toBe('MiniMax-M2.7')
})

test('getDefaultMainLoopModelSetting defaults MiniMax to M3', async () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'

  const {
    getDefaultMainLoopModel,
    getDefaultMainLoopModelSetting,
  } = await importFreshModelModule()
  expect(getDefaultMainLoopModelSetting()).toBe('MiniMax-M3')
  expect(getDefaultMainLoopModel()).toBe('MiniMax-M3')
})

test('getDefaultMainLoopModelSetting defaults Xiaomi MiMo to mimo-v2.5-pro', async () => {
  process.env.MIMO_API_KEY = 'mimo-test'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'

  const {
    getDefaultMainLoopModel,
    getDefaultMainLoopModelSetting,
  } = await importFreshModelModule()
  expect(getDefaultMainLoopModelSetting()).toBe('mimo-v2.5-pro')
  expect(getDefaultMainLoopModel()).toBe('mimo-v2.5-pro')
})

test('modelDisplayString does not show Claude subscription default for Xiaomi MiMo', async () => {
  process.env.MIMO_API_KEY = 'mimo-test'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'

  const {
    modelDisplayString,
    renderDefaultModelSetting,
  } = await importFreshModelModule()
  expect(modelDisplayString(null)).toBe('Default (mimo-v2.5-pro)')
  expect(renderDefaultModelSetting('mimo-v2.5-pro')).toBe('mimo-v2.5-pro')
})

test('modelDisplayString does not show Claude subscription default for MiniMax', async () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7'

  const {
    modelDisplayString,
    renderDefaultModelSetting,
  } = await importFreshModelModule()
  expect(modelDisplayString(null)).toBe('Default (MiniMax-M2.7)')
  expect(renderDefaultModelSetting('MiniMax-M2.7')).toBe('MiniMax-M2.7')
})

test('getDefaultSonnetModel returns OPENAI_MODEL for NVIDIA NIM', async () => {
  process.env.NVIDIA_NIM = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  const { getDefaultSonnetModel } = await importFreshModelModule()
  expect(getDefaultSonnetModel()).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test('getDefaultHaikuModel returns OPENAI_MODEL for MiniMax', async () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5-highspeed'

  const { getDefaultHaikuModel } = await importFreshModelModule()
  expect(getDefaultHaikuModel()).toBe('MiniMax-M2.5-highspeed')
})

test('default helpers do not leak claude-* names to shim providers', async () => {
  // Umbrella guard: for each OpenAI-shim provider, none of the default-model
  // helpers may return an Anthropic-branded model name. That was the source
  // of the WebFetch 60s hang — MiniMax received "claude-haiku-4-5" and sat
  // on the connection.
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7'

  const {
    getSmallFastModel,
    getDefaultOpusModel,
    getDefaultSonnetModel,
    getDefaultHaikuModel,
  } = await importFreshModelModule()
  for (const fn of [
    getSmallFastModel,
    getDefaultOpusModel,
    getDefaultSonnetModel,
    getDefaultHaikuModel,
  ]) {
    const model = fn()
    expect(model.toLowerCase()).not.toContain('claude')
  }
})

test('default helpers do not leak claude-* names to Xiaomi MiMo', async () => {
  process.env.MIMO_API_KEY = 'mimo-test'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'

  const {
    getSmallFastModel,
    getDefaultOpusModel,
    getDefaultSonnetModel,
    getDefaultHaikuModel,
  } = await importFreshModelModule()
  for (const fn of [
    getSmallFastModel,
    getDefaultOpusModel,
    getDefaultSonnetModel,
    getDefaultHaikuModel,
  ]) {
    const model = fn()
    expect(model.toLowerCase()).not.toContain('claude')
    expect(model.toLowerCase()).not.toContain('opus')
  }
})

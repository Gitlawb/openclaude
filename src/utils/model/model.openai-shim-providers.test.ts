import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import {
  resetModelStringsForTestingOnly,
  setInitialMainLoopModel,
  setMainLoopModelOverride,
} from '../../bootstrap/state.js'
import { saveGlobalConfig } from '../config.js'
import * as actualProviders from './providers.js'

async function importFreshModelModule() {
  mock.module('../auth.js', () => ({
    getSubscriptionType: () => 'max',
    isClaudeAISubscriber: () => true,
    isMaxSubscriber: () => true,
    isProSubscriber: () => false,
    isTeamPremiumSubscriber: () => false,
  }))
  const providerMock = () => ({
    ...actualProviders,
    getAPIProvider: () => {
      if (process.env.NVIDIA_NIM) return 'nvidia-nim'
      if (process.env.MINIMAX_API_KEY) return 'minimax'
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
  })
  mock.module('./providers.js', providerMock)
  mock.module('src/utils/model/providers.js', providerMock)
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./model.js?ts=${nonce}`)
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
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  CHATGPT_ACCOUNT_ID: process.env.CHATGPT_ACCOUNT_ID,
}

function restoreEnv(key: keyof typeof SAVED_ENV): void {
  if (SAVED_ENV[key] === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = SAVED_ENV[key]
  }
}

beforeEach(() => {
  // Other test files (notably modelOptions.github.test.ts) install a
  // persistent mock.module for './providers.js' that overrides getAPIProvider
  // globally. Without mock.restore() here, those overrides bleed into this
  // suite and the provider-kind branches we're testing become unreachable.
  mock.restore()
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.NVIDIA_NIM
  delete process.env.MINIMAX_API_KEY
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_API_KEY
  delete process.env.XAI_API_KEY
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  setInitialMainLoopModel(null)
  setMainLoopModelOverride(undefined)
  resetModelStringsForTestingOnly()
  saveGlobalConfig(current => ({
    ...current,
    model: undefined,
  }))
})

afterEach(() => {
  mock.restore()
  for (const key of Object.keys(SAVED_ENV) as Array<keyof typeof SAVED_ENV>) {
    restoreEnv(key)
  }
  saveGlobalConfig(current => ({
    ...current,
    model: undefined,
  }))
  setInitialMainLoopModel(null)
  setMainLoopModelOverride(undefined)
  resetModelStringsForTestingOnly()
})

function useMiniMaxProvider(model?: string): void {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.io/v1'
  process.env.MINIMAX_API_KEY = 'minimax-test'
  if (model) {
    process.env.OPENAI_MODEL = model
  }
}

function useNvidiaProvider(model: string): void {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_MODEL = model
}

test.serial('codex provider reads OPENAI_MODEL, not stale settings.model', async () => {
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

test.serial('nvidia-nim provider reads OPENAI_MODEL, not stale settings.model', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'kimi-k2.6' }))
  process.env.NVIDIA_NIM = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test.serial('minimax provider reads OPENAI_MODEL, not stale settings.model', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'kimi-k2.6' }))
  useMiniMaxProvider('MiniMax-M2.5')

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('MiniMax-M2.5')
})

test.serial('openai provider still reads OPENAI_MODEL (regression guard)', async () => {
  saveGlobalConfig(current => ({ ...current, model: 'stale-default' }))
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-4o'

  const { getUserSpecifiedModelSetting } = await importFreshModelModule()
  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('gpt-4o')
})

test.serial('github provider still reads OPENAI_MODEL (regression guard)', async () => {
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

test.serial('getSmallFastModel returns OPENAI_MODEL for MiniMax (regression: WebFetch hang)', async () => {
  useMiniMaxProvider('MiniMax-M2.5-highspeed')

  const { getSmallFastModel } = await importFreshModelModule()
  expect(getSmallFastModel()).toBe('MiniMax-M2.5-highspeed')
})

test.serial('getSmallFastModel returns OPENAI_MODEL for Codex (regression)', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = 'codexspark'
  process.env.CODEX_API_KEY = 'codex-test'
  process.env.CHATGPT_ACCOUNT_ID = 'acct_test'

  const { getSmallFastModel } = await importFreshModelModule()
  expect(getSmallFastModel()).toBe('codexspark')
})

test.serial('getSmallFastModel returns OPENAI_MODEL for NVIDIA NIM (regression)', async () => {
  useNvidiaProvider('nvidia/llama-3.1-nemotron-70b-instruct')

  const { getSmallFastModel } = await importFreshModelModule()
  expect(getSmallFastModel()).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test.serial('getDefaultOpusModel returns OPENAI_MODEL for MiniMax', async () => {
  useMiniMaxProvider('MiniMax-M2.7')

  const { getDefaultOpusModel } = await importFreshModelModule()
  useMiniMaxProvider('MiniMax-M2.7')
  expect(getDefaultOpusModel()).toBe('MiniMax-M2.7')
})

test.serial('getDefaultMainLoopModelSetting defaults MiniMax to M2.7', async () => {
  useMiniMaxProvider()

  const {
    getDefaultMainLoopModel,
    getDefaultMainLoopModelSetting,
  } = await importFreshModelModule()
  useMiniMaxProvider()
  expect(getDefaultMainLoopModelSetting()).toBe('MiniMax-M2.7')
  expect(getDefaultMainLoopModel()).toBe('MiniMax-M2.7')
})

test.serial('modelDisplayString does not show Claude subscription default for MiniMax', async () => {
  useMiniMaxProvider('MiniMax-M2.7')

  const {
    modelDisplayString,
    renderDefaultModelSetting,
  } = await importFreshModelModule()
  useMiniMaxProvider('MiniMax-M2.7')
  expect(modelDisplayString(null)).toBe('Default (MiniMax-M2.7)')
  expect(renderDefaultModelSetting('MiniMax-M2.7')).toBe('MiniMax M2.7')
})

test.serial('getDefaultSonnetModel returns OPENAI_MODEL for NVIDIA NIM', async () => {
  useNvidiaProvider('nvidia/llama-3.1-nemotron-70b-instruct')

  const { getDefaultSonnetModel } = await importFreshModelModule()
  useNvidiaProvider('nvidia/llama-3.1-nemotron-70b-instruct')
  expect(getDefaultSonnetModel()).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test.serial('getDefaultHaikuModel returns OPENAI_MODEL for MiniMax', async () => {
  useMiniMaxProvider('MiniMax-M2.5-highspeed')

  const { getDefaultHaikuModel } = await importFreshModelModule()
  useMiniMaxProvider('MiniMax-M2.5-highspeed')
  expect(getDefaultHaikuModel()).toBe('MiniMax-M2.5-highspeed')
})

test.serial('default helpers do not leak claude-* names to shim providers', async () => {
  // Umbrella guard: for each OpenAI-shim provider, none of the default-model
  // helpers may return an Anthropic-branded model name. That was the source
  // of the WebFetch 60s hang — MiniMax received "claude-haiku-4-5" and sat
  // on the connection.
  useMiniMaxProvider('MiniMax-M2.7')

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

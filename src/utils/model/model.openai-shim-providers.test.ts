import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { saveGlobalConfig } from '../config.js'
import {
  getDefaultHaikuModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getSmallFastModel,
  getUserSpecifiedModelSetting,
} from './model.js'

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
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  saveGlobalConfig(current => ({
    ...current,
    model: undefined,
  }))
})

afterEach(() => {
  for (const key of Object.keys(SAVED_ENV) as Array<keyof typeof SAVED_ENV>) {
    restoreEnv(key)
  }
  saveGlobalConfig(current => ({
    ...current,
    model: undefined,
  }))
})

test('codex provider reads OPENAI_MODEL, not stale settings.model', () => {
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

  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('codexplan')
})

test('nvidia-nim provider reads OPENAI_MODEL, not stale settings.model', () => {
  saveGlobalConfig(current => ({ ...current, model: 'kimi-k2.6' }))
  process.env.NVIDIA_NIM = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test('minimax provider reads OPENAI_MODEL, not stale settings.model', () => {
  saveGlobalConfig(current => ({ ...current, model: 'kimi-k2.6' }))
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5'

  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('MiniMax-M2.5')
})

test('openai provider still reads OPENAI_MODEL (regression guard)', () => {
  saveGlobalConfig(current => ({ ...current, model: 'stale-default' }))
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-4o'

  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('gpt-4o')
})

test('github provider still reads OPENAI_MODEL (regression guard)', () => {
  saveGlobalConfig(current => ({ ...current, model: 'stale-default' }))
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'github:copilot'

  const model = getUserSpecifiedModelSetting()
  expect(model).toBe('github:copilot')
})

// ---------------------------------------------------------------------------
// Default model helpers — must not fall through to claude-haiku-4-5 etc. for
// OpenAI-shim providers whose endpoints don't speak Anthropic model names.
// Hitting that fallthrough caused WebFetch to hang for 60s on MiniMax/Codex
// because queryHaiku() shipped an unknown model id to the shim endpoint.
// ---------------------------------------------------------------------------

test('getSmallFastModel returns OPENAI_MODEL for MiniMax (regression: WebFetch hang)', () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5-highspeed'

  expect(getSmallFastModel()).toBe('MiniMax-M2.5-highspeed')
})

test('getSmallFastModel returns OPENAI_MODEL for Codex (regression)', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = 'codexspark'
  process.env.CODEX_API_KEY = 'codex-test'
  process.env.CHATGPT_ACCOUNT_ID = 'acct_test'

  expect(getSmallFastModel()).toBe('codexspark')
})

test('getSmallFastModel returns OPENAI_MODEL for NVIDIA NIM (regression)', () => {
  process.env.NVIDIA_NIM = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  expect(getSmallFastModel()).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test('getDefaultOpusModel returns OPENAI_MODEL for MiniMax', () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7'

  expect(getDefaultOpusModel()).toBe('MiniMax-M2.7')
})

test('getDefaultSonnetModel returns OPENAI_MODEL for NVIDIA NIM', () => {
  process.env.NVIDIA_NIM = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  expect(getDefaultSonnetModel()).toBe('nvidia/llama-3.1-nemotron-70b-instruct')
})

test('getDefaultHaikuModel returns OPENAI_MODEL for MiniMax', () => {
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5-highspeed'

  expect(getDefaultHaikuModel()).toBe('MiniMax-M2.5-highspeed')
})

test('default helpers do not leak claude-* names to shim providers', () => {
  // Umbrella guard: for each OpenAI-shim provider, none of the default-model
  // helpers may return an Anthropic-branded model name. That was the source
  // of the WebFetch 60s hang — MiniMax received "claude-haiku-4-5" and sat
  // on the connection.
  process.env.MINIMAX_API_KEY = 'minimax-test'
  process.env.OPENAI_MODEL = 'MiniMax-M2.7'

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


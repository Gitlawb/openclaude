import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import { saveGlobalConfig } from '../config.js'

async function importFreshModelOptionsModule(provider: 'codex' | 'openai') {
  mock.restore()
  mock.module('./providers.js', () => ({
    getAPIProvider: () => provider,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./modelOptions.js?ts=${nonce}`)
}

const originalEnv = {
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}

beforeEach(() => {
  mock.restore()
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_BASE_URL
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
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

test('Codex provider exposes Codex models instead of Anthropic aliases in /model options', async () => {
  process.env.OPENAI_MODEL = 'gpt-5.4'

  const { getModelOptions } = await importFreshModelOptionsModule('codex')
  const options = getModelOptions(false)

  expect(options.some(option => option.value === 'gpt-5.4')).toBe(true)
  expect(options.some(option => option.label === 'Sonnet')).toBe(false)
  expect(options.some(option => option.label === 'Opus')).toBe(false)
})

test('OpenAI-compatible provider keeps the configured model without showing Anthropic aliases', async () => {
  process.env.OPENAI_MODEL = 'deepseek-chat'

  const { getModelOptions } = await importFreshModelOptionsModule('openai')
  const options = getModelOptions(false)

  expect(options.some(option => option.value === 'deepseek-chat')).toBe(true)
  expect(options.some(option => option.label === 'Sonnet')).toBe(false)
  expect(options.some(option => option.label === 'Opus')).toBe(false)
})

test('switching between Codex and OpenAI rebuilds /model options from the active provider context', async () => {
  process.env.OPENAI_MODEL = 'gpt-5.4'
  const codexModule = await importFreshModelOptionsModule('codex')
  const codexOptions = codexModule.getModelOptions(false)

  expect(codexOptions.some(option => option.value === 'gpt-5.4')).toBe(true)

  process.env.OPENAI_MODEL = 'deepseek-chat'
  const openaiModule = await importFreshModelOptionsModule('openai')
  const openaiOptions = openaiModule.getModelOptions(false)

  expect(openaiOptions.some(option => option.value === 'deepseek-chat')).toBe(
    true,
  )
  expect(openaiOptions.some(option => option.value === 'gpt-5.4')).toBe(false)
})

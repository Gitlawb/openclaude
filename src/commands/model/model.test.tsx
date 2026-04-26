import { afterEach, expect, mock, test } from 'bun:test'

import { getAdditionalModelOptionsCacheScope } from '../../services/api/providerConfig.js'

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
}

afterEach(() => {
  mock.restore()
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.CLAUDE_CODE_USE_GEMINI = originalEnv.CLAUDE_CODE_USE_GEMINI
  process.env.CLAUDE_CODE_USE_GITHUB = originalEnv.CLAUDE_CODE_USE_GITHUB
  process.env.CLAUDE_CODE_USE_MISTRAL = originalEnv.CLAUDE_CODE_USE_MISTRAL
  process.env.CLAUDE_CODE_USE_BEDROCK = originalEnv.CLAUDE_CODE_USE_BEDROCK
  process.env.CLAUDE_CODE_USE_VERTEX = originalEnv.CLAUDE_CODE_USE_VERTEX
  process.env.CLAUDE_CODE_USE_FOUNDRY = originalEnv.CLAUDE_CODE_USE_FOUNDRY
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_API_BASE = originalEnv.OPENAI_API_BASE
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
})

test('opens the model picker without awaiting local model discovery refresh', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_API_BASE
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8080/v1'
  process.env.OPENAI_MODEL = 'qwen2.5-coder-7b-instruct'

  let resolveDiscovery: (() => void) | undefined
  const discoverOpenAICompatibleModelOptions = mock(
    () =>
      new Promise<void>(resolve => {
        resolveDiscovery = resolve
      }),
  )

  mock.module('../../utils/model/openaiModelDiscovery.js', () => ({
    discoverOpenAICompatibleModelOptions,
  }))

  expect(getAdditionalModelOptionsCacheScope()).toBe('openai:http://127.0.0.1:8080/v1')

  const nonce = `${Date.now()}-${Math.random()}`
  const { call } = await import(`./model.js?ts=${nonce}`)
  const result = await Promise.race([
    call(() => {}, {} as never, ''),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
  ])

  resolveDiscovery?.()

  expect(result).not.toBe('timeout')
})

test('awaits GitHub model refresh before opening picker when cache is empty', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY

  let resolveRefresh: (() => void) | undefined
  const refreshGithubModelsCache = mock(
    () =>
      new Promise<void>(resolve => {
        resolveRefresh = resolve
      }),
  )

  mock.module('../../utils/model/githubModels.js', () => ({
    getCachedGithubModelOptions: () => [],
    refreshGithubModelsCache,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { call } = await import(`./model.js?ts=${nonce}`)
  const pendingCall = call(() => {}, {} as never, '')
  const result = await Promise.race([
    pendingCall,
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
  ])

  expect(result).toBe('timeout')

  resolveRefresh?.()
  await pendingCall

  expect(refreshGithubModelsCache).toHaveBeenCalled()
})

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realApiClient from './api/client.js'
import * as realVcr from './vcr.js'
import * as realBetas from '../utils/betas.js'
import * as realLog from '../utils/log.js'
import * as realModel from '../utils/model/model.js'
import * as realProviders from '../utils/model/providers.js'

let anthropicClient: unknown

const getAnthropicClient = mock(async () => anthropicClient)

function createShimClientWithoutCountTokens(): unknown {
  return {
    beta: {
      messages: {
        create: async () => ({
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    },
  }
}

async function loadTokenEstimationForTesting() {
  return import(`./tokenEstimation.js?ts=${Date.now()}-${Math.random()}`)
}

function applyMocks() {
  mock.module('./api/client.js', () => ({
    ...realApiClient,
    getAnthropicClient,
  }))
  mock.module('./vcr.js', () => ({
    ...realVcr,
    withTokenCountVCR: async (
      _messages: unknown,
      _tools: unknown,
      run: () => Promise<unknown>,
    ) => run(),
  }))
  mock.module('../utils/betas.js', () => ({
    ...realBetas,
    getModelBetas: () => [],
  }))
  mock.module('../utils/log.js', () => ({
    ...realLog,
    logError: () => {},
  }))
  mock.module('../utils/model/model.js', () => ({
    ...realModel,
    getMainLoopModel: () => 'gpt-4o',
    normalizeModelStringForAPI: (model: string) => model,
  }))
  mock.module('../utils/model/providers.js', () => ({
    ...realProviders,
    getAPIProvider: () => 'openai',
  }))
}

function restoreMocks() {
  mock.restore()
  mock.module('./api/client.js', () => realApiClient)
  mock.module('./vcr.js', () => realVcr)
  mock.module('../utils/betas.js', () => realBetas)
  mock.module('../utils/log.js', () => realLog)
  mock.module('../utils/model/model.js', () => realModel)
  mock.module('../utils/model/providers.js', () => realProviders)
}

beforeEach(async () => {
  await acquireSharedMutationLock('tokenEstimation.test.ts')
  anthropicClient = createShimClientWithoutCountTokens()
  getAnthropicClient.mockClear()
  applyMocks()
})

afterEach(() => {
  restoreMocks()
  releaseSharedMutationLock()
})

test('countMessagesTokensWithAPI falls back when shim client lacks countTokens', async () => {
  const { countMessagesTokensWithAPI, roughTokenCountEstimation } =
    await loadTokenEstimationForTesting()
  const content = 'hello from an openai-compatible provider'

  const result = await countMessagesTokensWithAPI(
    [{ role: 'user', content }],
    [],
  )

  expect(getAnthropicClient).toHaveBeenCalledTimes(1)
  expect(result).toBe(roughTokenCountEstimation(content))
})

test('countMessagesTokensWithAPI uses countTokens when the client supports it', async () => {
  const countTokens = mock(async () => ({ input_tokens: 42 }))
  anthropicClient = {
    beta: {
      messages: {
        countTokens,
      },
    },
  }
  const { countMessagesTokensWithAPI } = await loadTokenEstimationForTesting()

  const result = await countMessagesTokensWithAPI(
    [{ role: 'user', content: 'use exact count when available' }],
    [],
  )

  expect(countTokens).toHaveBeenCalledTimes(1)
  expect(result).toBe(42)
})

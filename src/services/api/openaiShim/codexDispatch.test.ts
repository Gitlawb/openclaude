import { APIError } from '@anthropic-ai/sdk'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../../test/sharedMutationLock.js'
import type { performCodexRequest } from '../codexShim.js'
import type { ResolvedProviderRequest } from '../providerConfig.js'
import {
  dispatchCodexRequest,
  type CodexDispatchDependencies,
} from './codexDispatch.js'

const originalEnv = {
  CHATGPT_ACCOUNT_ID: process.env.CHATGPT_ACCOUNT_ID,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CODEX_ACCOUNT_ID: process.env.CODEX_ACCOUNT_ID,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  CODEX_AUTH_JSON_PATH: process.env.CODEX_AUTH_JSON_PATH,
  CODEX_HOME: process.env.CODEX_HOME,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
}

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(async () => {
  await acquireSharedMutationLock('openaiShim/codexDispatch.test.ts')
  delete process.env.CHATGPT_ACCOUNT_ID
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CODEX_ACCOUNT_ID
  delete process.env.CODEX_API_KEY
  delete process.env.CODEX_AUTH_JSON_PATH
  delete process.env.CODEX_HOME
  delete process.env.OPENAI_API_KEY
})

afterEach(() => {
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    restoreEnv(key)
  }
  releaseSharedMutationLock()
})

const params = {
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 32,
}

function request(
  transport: ResolvedProviderRequest['transport'],
  baseUrl = 'https://api.openai.com/v1',
): ResolvedProviderRequest {
  return {
    transport,
    requestedModel: 'gpt-5',
    resolvedModel: 'gpt-5',
    baseUrl,
  }
}

const dependencies: CodexDispatchDependencies = {
  classifyResponseHeadersTimeout: () => undefined,
  fetchWithHeadersDeadline: () => Promise.reject(new Error('not expected')),
  getApiTimeoutMs: () => 1_000,
  isCopilotTokenExpiredError: text => text.includes('expired'),
  preserveCallerAbortError: error => error,
}

test('returns null when the ordinary OpenAI dispatcher owns the request', async () => {
  const response = await dispatchCodexRequest({
    request: request('chat_completions'),
    params,
    defaultHeaders: {},
    dependencies,
    operations: { isGithubModelsMode: () => false },
  })

  expect(response).toBeNull()
})

test('refreshes an expired GitHub Copilot token once before retrying', async () => {
  process.env.OPENAI_API_KEY = 'initial-token'
  const observedKeys: string[] = []
  const perform = mock(async options => {
    observedKeys.push(options.credentials.apiKey)
    if (observedKeys.length === 1) {
      throw APIError.generate(401, undefined, 'token expired', new Headers())
    }
    return new Response('ok')
  }) as unknown as typeof performCodexRequest
  const refresh = mock(async () => {
    process.env.OPENAI_API_KEY = 'refreshed-token'
    return true
  })

  const response = await dispatchCodexRequest({
    request: request('codex_responses', 'https://api.githubcopilot.com'),
    params,
    defaultHeaders: {},
    dependencies,
    operations: {
      isGithubModelsMode: () => true,
      performCodexRequest: perform,
      refreshCopilotTokenOn401: refresh,
    },
  })

  expect(await response?.text()).toBe('ok')
  expect(observedKeys).toEqual(['initial-token', 'refreshed-token'])
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('classifies a GitHub Copilot pre-header timeout without replaying', async () => {
  process.env.OPENAI_API_KEY = 'test-token'
  const timeout = new Error('headers timed out')
  const classified = new Error('classified non-replayable timeout')
  const fetchWithDeadline = mock(async () => {
    throw timeout
  })
  const classify = mock((error: unknown) =>
    error === timeout ? classified : undefined,
  )
  const perform = mock(async options =>
    options.fetcher?.('https://api.githubcopilot.com/responses', {}),
  ) as unknown as typeof performCodexRequest

  await expect(dispatchCodexRequest({
    request: request('codex_responses', 'https://api.githubcopilot.com'),
    params,
    defaultHeaders: {},
    dependencies: {
      ...dependencies,
      classifyResponseHeadersTimeout: classify,
      fetchWithHeadersDeadline: fetchWithDeadline,
    },
    operations: {
      isGithubModelsMode: () => true,
      performCodexRequest: perform,
    },
  })).rejects.toBe(classified)

  expect(fetchWithDeadline).toHaveBeenCalledTimes(1)
  expect(classify).toHaveBeenCalledTimes(1)
})

test('uses refreshed first-party Codex credentials for dispatch', async () => {
  let observedCredentials: { apiKey: string; accountId?: string } | undefined
  const perform = mock(async options => {
    observedCredentials = options.credentials
    return new Response('ok')
  }) as unknown as typeof performCodexRequest

  const response = await dispatchCodexRequest({
    request: request('codex_responses', 'https://chatgpt.com/backend-api/codex'),
    params,
    defaultHeaders: {},
    dependencies,
    operations: {
      isGithubModelsMode: () => false,
      performCodexRequest: perform,
      refreshCodexAccessTokenIfNeeded: async () => ({
        refreshed: true,
        credentials: {
          accessToken: 'codex-access-token',
          accountId: 'account-1',
        },
      }),
    },
  })

  expect(await response?.text()).toBe('ok')
  expect(observedCredentials).toMatchObject({
    apiKey: 'codex-access-token',
    accountId: 'account-1',
  })
})

test('rejects first-party Codex credentials without an account id', async () => {
  await expect(dispatchCodexRequest({
    request: request('codex_responses', 'https://chatgpt.com/backend-api/codex'),
    params,
    defaultHeaders: {},
    dependencies,
    operations: {
      isGithubModelsMode: () => false,
      refreshCodexAccessTokenIfNeeded: async () => ({
        refreshed: false,
        credentials: { accessToken: 'codex-access-token' },
      }),
    },
  })).rejects.toThrow('Codex auth is missing chatgpt_account_id')
})

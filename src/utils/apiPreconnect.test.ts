import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realProviders from './model/providers.js'

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

async function importFreshModule() {
  mock.restore()
  return import(`./apiPreconnect.ts?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/apiPreconnect.test.ts')
  process.env = { ...originalEnv }
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    globalThis.fetch = originalFetch
    mock.restore()
    mock.module('./model/providers.js', () => realProviders)
  } finally {
    releaseSharedMutationLock()
  }
})

describe('preconnectAnthropicApi', () => {
  test('does not fetch when OpenAI mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    mock.module('./model/providers.js', () => ({
      ...realProviders,
      getAPIProvider: () => 'openai',
    }))
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not fetch when Gemini mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    mock.module('./model/providers.js', () => ({
      ...realProviders,
      getAPIProvider: () => 'gemini',
    }))
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not fetch when GitHub mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    mock.module('./model/providers.js', () => ({
      ...realProviders,
      getAPIProvider: () => 'github',
    }))
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fetches in first-party mode', async () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.HTTPS_PROXY
    delete process.env.https_proxy
    delete process.env.HTTP_PROXY
    delete process.env.http_proxy
    delete process.env.ANTHROPIC_UNIX_SOCKET
    delete process.env.CLAUDE_CODE_CLIENT_CERT
    delete process.env.CLAUDE_CODE_CLIENT_KEY

    mock.module('./model/providers.js', () => ({
      ...realProviders,
      getAPIProvider: () => 'firstParty',
    }))
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

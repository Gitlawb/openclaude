import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import axios from 'axios'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = { ...process.env }
const originalAxiosGet = axios.get

async function importFreshModule() {
  mock.restore()
  return import(`./officialRegistry.ts?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await acquireSharedMutationLock('services/mcp/officialRegistry.test.ts')
  process.env = { ...originalEnv }
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    axios.get = originalAxiosGet
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('prefetchOfficialMcpUrls', () => {
  test('does not fetch registry when using OpenAI mode', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    mock.module('../../utils/model/providers.js', () => ({
      getAPIProvider: () => 'openai',
    }))
    const getSpy = mock(() => Promise.resolve({ data: { servers: [] } }))
    axios.get = getSpy as typeof axios.get

    const { prefetchOfficialMcpUrls } = await importFreshModule()
    await prefetchOfficialMcpUrls()

    expect(getSpy).not.toHaveBeenCalled()
  })

  test('does not fetch registry when using Gemini mode', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    mock.module('../../utils/model/providers.js', () => ({
      getAPIProvider: () => 'gemini',
    }))
    const getSpy = mock(() => Promise.resolve({ data: { servers: [] } }))
    axios.get = getSpy as typeof axios.get

    const { prefetchOfficialMcpUrls } = await importFreshModule()
    await prefetchOfficialMcpUrls()

    expect(getSpy).not.toHaveBeenCalled()
  })

  test('fetches registry in first-party mode', async () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GITHUB

    mock.module('../../utils/model/providers.js', () => ({
      getAPIProvider: () => 'firstParty',
    }))
    const getSpy = mock(() =>
      Promise.resolve({
        data: {
          servers: [{ server: { remotes: [{ url: 'https://example.com/mcp' }] } }],
        },
      }),
    )
    axios.get = getSpy as typeof axios.get

    const { prefetchOfficialMcpUrls, isOfficialMcpUrl } = await importFreshModule()
    await prefetchOfficialMcpUrls()

    expect(getSpy).toHaveBeenCalledTimes(1)
    expect(isOfficialMcpUrl('https://example.com/mcp')).toBe(true)
  })
})

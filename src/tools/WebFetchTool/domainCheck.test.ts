import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import axios from 'axios'

const originalEnv = { ...process.env }

async function importFreshModule() {
  mock.restore()
  return import(`./providers/default.ts?ts=${Date.now()}-${Math.random()}`)
}

function mockProviders(getAPIProvider: () => string) {
  mock.module('../../../utils/model/providers.js', () => ({
    getAPIProvider,
    getAPIProviderForStatsig: () => 'firstParty',
    isFirstPartyAnthropicBaseUrl: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
}

beforeEach(() => { process.env = { ...originalEnv } })
afterEach(() => { process.env = { ...originalEnv }; mock.restore() })

describe('checkDomainBlocklist', () => {
  test('returns allowed without API call in OpenAI mode', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    mockProviders(() => 'openai')
    const spy = mock(() => Promise.resolve({ status: 200, data: { can_fetch: true } }))
    axios.get = spy as typeof axios.get
    const { checkDomainBlocklist } = await importFreshModule()
    expect((await checkDomainBlocklist('example.com')).status).toBe('allowed')
    expect(spy).not.toHaveBeenCalled()
  })
  test('returns allowed without API call in Gemini mode', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    mockProviders(() => 'gemini')
    const spy = mock(() => Promise.resolve({ status: 200, data: { can_fetch: true } }))
    axios.get = spy as typeof axios.get
    const { checkDomainBlocklist } = await importFreshModule()
    expect((await checkDomainBlocklist('example.com')).status).toBe('allowed')
    expect(spy).not.toHaveBeenCalled()
  })
  test('calls Anthropic domain check in first-party mode', async () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GITHUB
    mockProviders(() => 'firstParty')
    const spy = mock(() => Promise.resolve({ status: 200, data: { can_fetch: true } }))
    axios.get = spy as typeof axios.get
    const { checkDomainBlocklist } = await importFreshModule()
    expect((await checkDomainBlocklist('example.com')).status).toBe('allowed')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

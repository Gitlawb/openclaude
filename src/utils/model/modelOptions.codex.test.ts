import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

async function importFreshModelOptionsModule() {
  mock.restore()
  mock.module('./providers.js', () => ({
    getAPIProvider: () => 'codex',
    getAPIProviderForStatsig: () => 'codex',
    isFirstPartyAnthropicBaseUrl: () => false,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./modelOptions.js?ts=${nonce}`)
}

beforeEach(() => {
  mock.restore()
})

afterEach(() => {
  mock.restore()
})

test('Codex provider model options are generated from the catalog', async () => {
  const { getModelOptions } = await importFreshModelOptionsModule()
  const values = getModelOptions(false).map(
    (option: { value: unknown }) => option.value,
  )

  expect(values).toContain('gpt-5.2')
  expect(values).toContain('gpt-5.3-codex-spark')
})

import { afterEach, expect, mock, test } from 'bun:test'

afterEach(() => {
  mock.restore()
})

async function importFreshTeammateModelModule(provider = 'mistral') {
  mock.restore()
  mock.module('../model/providers.js', () => ({
    getAPIProvider: () => provider,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./teammateModel.js?ts=${nonce}`)
}

test('getHardcodedTeammateModelFallback returns a Mistral fallback in mistral mode', async () => {
  const { getHardcodedTeammateModelFallback } =
    await importFreshTeammateModelModule()

  expect(getHardcodedTeammateModelFallback()).toBe('devstral-latest')
})

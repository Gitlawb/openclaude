import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
}

async function importFreshValidateModelModule() {
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./validateModel.ts?ts=${nonce}`)
}

beforeEach(() => {
  mock.restore()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
})

afterEach(() => {
  mock.restore()
  if (originalEnv.CLAUDE_CODE_USE_OPENAI === undefined) {
    delete process.env.CLAUDE_CODE_USE_OPENAI
  } else {
    process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  }
})

test('claude-sonnet-4-6 fallback suggestion comes from catalog metadata', async () => {
  mock.module('./modelStrings.js', () => ({
    getModelStrings: () => ({
      sonnet45: 'legacy-hardcoded-sonnet-fallback',
    }),
    resolveOverriddenModel: (modelId: string) => modelId,
  }))

  const { get3PFallbackSuggestionForTesting } =
    await importFreshValidateModelModule()

  const result = get3PFallbackSuggestionForTesting('claude-sonnet-4-6')

  expect(result).toBe('claude-sonnet-4-5')
})

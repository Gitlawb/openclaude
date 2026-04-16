import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'

const originalEnv = {
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
}

async function importFreshModelModule(provider: 'openai' | 'codex') {
  mock.restore()
  mock.module('./providers.js', () => ({
    getAPIProvider: () => provider,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./model.js?ts=${nonce}`)
}

beforeEach(() => {
  mock.restore()
  delete process.env.OPENAI_MODEL
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  delete process.env.CLAUDE_CODE_USE_OPENAI
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL =
    originalEnv.ANTHROPIC_DEFAULT_SONNET_MODEL
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  resetModelStringsForTestingOnly()
  mock.restore()
})

test.each([
  ['openai', 'gpt-4o', 'GPT-4o'],
  ['codex', 'gpt-5.4', 'GPT-5.4'],
] as const)(
  'Sonnet resolves to a provider-specific model under %s',
  async (provider, expectedModel, expectedDisplay) => {
    const { getDefaultSonnetModel, parseUserSpecifiedModel, renderDefaultModelSetting } =
      await importFreshModelModule(provider)

    expect(getDefaultSonnetModel()).toBe(expectedModel)
    expect(parseUserSpecifiedModel('sonnet')).toBe(expectedModel)
    expect(renderDefaultModelSetting('sonnet')).toBe(expectedDisplay)
  },
)

test('provider switching does not retain a previous provider\'s sonnet mapping', async () => {
  const openaiModule = await importFreshModelModule('openai')
  const openaiResolved = openaiModule.parseUserSpecifiedModel('sonnet')

  const codexModule = await importFreshModelModule('codex')
  const codexResolved = codexModule.parseUserSpecifiedModel('sonnet')

  expect(openaiResolved).not.toBe(codexResolved)
  expect(codexModule.parseUserSpecifiedModel('sonnet')).toBe('gpt-5.4')
})

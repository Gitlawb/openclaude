import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const actualProviders = await import('../model/providers.js')
let originalAnthropicModel: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('utils/swarm/teammateModel.test.ts')
  originalAnthropicModel = process.env.ANTHROPIC_MODEL
})

afterEach(() => {
  try {
    if (originalAnthropicModel !== undefined) {
      process.env.ANTHROPIC_MODEL = originalAnthropicModel
    } else {
      delete process.env.ANTHROPIC_MODEL
    }
    mock.module('../model/providers.js', () => actualProviders)
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFreshTeammateModelModule(
  provider = 'mistral',
  options?: { isFirstParty?: boolean; isCustom?: boolean },
) {
  mock.module('../model/providers.js', () => ({
    ...actualProviders,
    getAPIProvider: () => provider,
    isFirstPartyAnthropicProvider: () =>
      options?.isFirstParty ?? (provider === 'firstParty' && !options?.isCustom),
    isCustomAnthropicProvider: () => options?.isCustom ?? false,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./teammateModel.js?ts=${nonce}`)
}

test('getHardcodedTeammateModelFallback returns a Mistral fallback in mistral mode', async () => {
  const { getHardcodedTeammateModelFallback } =
    await importFreshTeammateModelModule()

  expect(getHardcodedTeammateModelFallback()).toBe('devstral-latest')
})

test('getHardcodedTeammateModelFallback returns the current default Opus (5) for first party', async () => {
  // Regression for #1769: the fallback hardcoded Opus 4.6 while the default Opus
  // moved on, so new teammates spawned on an older model. First party now
  // defaults to Opus 5; 3P stays on the Opus 4.8 ids until it rolls out there.
  const { getHardcodedTeammateModelFallback } =
    await importFreshTeammateModelModule('firstParty', { isFirstParty: true })

  expect(getHardcodedTeammateModelFallback()).toBe('claude-opus-5')
})

test('getHardcodedTeammateModelFallback distinguishes custom Anthropic endpoints', async () => {
  delete process.env.ANTHROPIC_MODEL
  const { getHardcodedTeammateModelFallback: getFallbackWithoutEnv } =
    await importFreshTeammateModelModule('firstParty', {
      isFirstParty: false,
      isCustom: true,
    })
  expect(getFallbackWithoutEnv()).toBe('claude-opus-4-8')

  process.env.ANTHROPIC_MODEL = 'custom-claude-model'
  const { getHardcodedTeammateModelFallback: getFallbackWithEnv } =
    await importFreshTeammateModelModule('firstParty', {
      isFirstParty: false,
      isCustom: true,
    })
  expect(getFallbackWithEnv()).toBe('custom-claude-model')
})

test('getHardcodedTeammateModelFallback is provider-aware (Bedrock gets the Opus 4.8 Bedrock id)', async () => {
  const { getHardcodedTeammateModelFallback } =
    await importFreshTeammateModelModule('bedrock')

  expect(getHardcodedTeammateModelFallback()).toBe(
    'us.anthropic.claude-opus-4-8-v1',
  )
})

test('getHardcodedTeammateModelFallback returns the Codex default (GPT-5.6 Sol) for codex', async () => {
  const { getHardcodedTeammateModelFallback } =
    await importFreshTeammateModelModule('codex')

  expect(getHardcodedTeammateModelFallback()).toBe('gpt-5.6-sol')
})

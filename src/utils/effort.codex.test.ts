import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
// Import the real auth.js and providerConfig.js up front so we can spread
// their export surfaces into mock factories. `mock.module()` is process-global
// in bun:test and `mock.restore()` does not undo it (see user.test.ts), so
// any module we mock here needs to keep the full original export shape — or
// downstream tests that load it via openaiShim/client/codexShim crash with
// "Export named 'X' not found in module".
import * as actualAuth from './auth.js'
import * as actualProviderConfig from '../services/api/providerConfig.js'
import * as actualThinking from './thinking.js'
import * as actualGrowthbook from 'src/services/analytics/growthbook.js'
import * as actualProviders from './model/providers.js'
import * as actualModelSupportOverrides from './model/modelSupportOverrides.js'

beforeEach(async () => {
  await acquireSharedMutationLock('utils/effort.codex.test.ts')
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFreshEffortModule(options: {
  provider: 'codex' | 'openai'
  supportsCodexReasoningEffort: boolean
}) {
  mock.module('./model/providers.js', () => ({
    ...actualProviders,
    getAPIProvider: () => options.provider,
  }))
  mock.module('./model/modelSupportOverrides.js', () => ({
    ...actualModelSupportOverrides,
    get3PModelCapabilityOverride: () => undefined,
  }))
  mock.module('../services/api/providerConfig.js', () => ({
    ...actualProviderConfig,
    supportsCodexReasoningEffort: () => options.supportsCodexReasoningEffort,
  }))
  mock.module('./auth.js', () => ({
    ...actualAuth,
    isProSubscriber: () => false,
    isMaxSubscriber: () => false,
    isTeamSubscriber: () => false,
  }))
  mock.module('./thinking.js', () => ({
    ...actualThinking,
    isUltrathinkEnabled: () => false,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...actualGrowthbook,
    getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, fallback: unknown) =>
      fallback,
  }))

  return import(`./effort.js?ts=${Date.now()}-${Math.random()}`)
}

test('gpt-5.4 on the ChatGPT Codex backend supports effort selection', async () => {
  const { getAvailableEffortLevels, modelSupportsEffort } =
    await importFreshEffortModule({
      provider: 'codex',
      supportsCodexReasoningEffort: true,
    })

  expect(modelSupportsEffort('gpt-5.4')).toBe(true)
  expect(getAvailableEffortLevels('gpt-5.4')).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
  ])
})

test('gpt-5.4 on the OpenAI provider still supports effort selection', async () => {
  const { getAvailableEffortLevels, modelSupportsEffort } =
    await importFreshEffortModule({
      provider: 'openai',
      supportsCodexReasoningEffort: true,
    })

  expect(modelSupportsEffort('gpt-5.4')).toBe(true)
  expect(getAvailableEffortLevels('gpt-5.4')).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
  ])
})

test('gpt-5.3-codex-spark stays without effort controls', async () => {
  const { getAvailableEffortLevels, modelSupportsEffort } =
    await importFreshEffortModule({
      provider: 'codex',
      supportsCodexReasoningEffort: false,
    })

  expect(modelSupportsEffort('gpt-5.3-codex-spark')).toBe(false)
  expect(getAvailableEffortLevels('gpt-5.3-codex-spark')).toEqual([])
})

test('toPersistableEffort passes xhigh through as a first-class level', async () => {
  const { toPersistableEffort } = await importFreshEffortModule({
    provider: 'openai',
    supportsCodexReasoningEffort: true,
  })

  expect(toPersistableEffort('xhigh')).toBe('xhigh')
  expect(toPersistableEffort('max')).toBe('max')
  expect(toPersistableEffort('high')).toBe('high')
  expect(toPersistableEffort('medium')).toBe('medium')
  expect(toPersistableEffort('low')).toBe('low')
  expect(toPersistableEffort(undefined)).toBeUndefined()
})

test('standardEffortToOpenAI maps max to xhigh for shim payload', async () => {
  const { standardEffortToOpenAI, openAIEffortToStandard } =
    await importFreshEffortModule({
      provider: 'openai',
      supportsCodexReasoningEffort: true,
    })

  expect(standardEffortToOpenAI('max')).toBe('xhigh')
  expect(standardEffortToOpenAI('xhigh')).toBe('xhigh')
  expect(standardEffortToOpenAI('high')).toBe('high')
  expect(openAIEffortToStandard('xhigh')).toBe('xhigh')
  expect(openAIEffortToStandard('high')).toBe('high')
})

test('e2e: xhigh → persisted xhigh → resolveAppliedEffort → wire xhigh on OpenAI/Codex (no high clamp)', async () => {
  const {
    toPersistableEffort,
    resolveAppliedEffort,
    standardEffortToOpenAI,
  } = await importFreshEffortModule({
    provider: 'openai',
    supportsCodexReasoningEffort: true,
  })

  // Picker writes 'xhigh'; toPersistableEffort passes it through.
  const persisted = toPersistableEffort('xhigh')
  expect(persisted).toBe('xhigh')

  // App state holds 'xhigh'. The OpenAI-shaped 'xhigh' is sent to the API as-is.
  const applied = resolveAppliedEffort('gpt-5.4', persisted)
  expect(applied).toBe('xhigh')

  // Final wire value the client shim emits.
  expect(standardEffortToOpenAI(applied as 'xhigh')).toBe('xhigh')
})

test('e2e: max on non-Opus Anthropic model still clamps to high', async () => {
  const { resolveAppliedEffort } = await importFreshEffortModule({
    provider: 'firstParty' as unknown as 'openai',
    supportsCodexReasoningEffort: false,
  })

  expect(resolveAppliedEffort('claude-sonnet-4-6', 'max')).toBe('high')
})

test('modelSupportsXHighEffort: opus-4-7 and opus-4-8 are allowed; other Claude models are not', async () => {
  const { modelSupportsXHighEffort } = await importFreshEffortModule({
    provider: 'firstParty' as unknown as 'openai',
    supportsCodexReasoningEffort: false,
  })

  expect(modelSupportsXHighEffort('claude-opus-4-7')).toBe(true)
  expect(modelSupportsXHighEffort('claude-opus-4-8')).toBe(true)
  expect(modelSupportsXHighEffort('opencode-claude-opus-4-8')).toBe(true)
  expect(modelSupportsXHighEffort('claude-opus-4-6')).toBe(false)
  expect(modelSupportsXHighEffort('claude-sonnet-4-6')).toBe(false)
  expect(modelSupportsXHighEffort('claude-sonnet-4-5')).toBe(false)
  expect(modelSupportsXHighEffort('claude-haiku-4-5')).toBe(false)
  expect(modelSupportsXHighEffort('claude-3-5-haiku')).toBe(false)
})

test('xhigh does not appear in available levels for non-supporting models', async () => {
  const { getAvailableEffortLevels } = await importFreshEffortModule({
    provider: 'firstParty' as unknown as 'openai',
    supportsCodexReasoningEffort: false,
  })

  // No xhigh, no max
  expect(getAvailableEffortLevels('claude-sonnet-4-6')).toEqual([
    'low',
    'medium',
    'high',
  ])
  expect(getAvailableEffortLevels('claude-haiku-4-5')).toEqual([])

  // Has xhigh AND max (opus-4-8)
  const opusLevels = getAvailableEffortLevels('claude-opus-4-8')
  expect(opusLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
})

test('xhigh clamps to high on non-supporting models so stale settings.json values do not produce API errors', async () => {
  const { resolveAppliedEffort } = await importFreshEffortModule({
    provider: 'firstParty' as unknown as 'openai',
    supportsCodexReasoningEffort: false,
  })

  // sonnet-4-6 supports effort but not xhigh — clamp
  expect(resolveAppliedEffort('claude-sonnet-4-6', 'xhigh')).toBe('high')
  // opus-4-8 supports xhigh — pass through
  expect(resolveAppliedEffort('claude-opus-4-8', 'xhigh')).toBe('xhigh')
})

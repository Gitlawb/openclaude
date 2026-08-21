import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realAuth from './auth.js'
import * as realThinking from './thinking.js'

const originalEnv = { ...process.env }
const routingEnvKeys = [
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'GEMINI_API_KEY',
  'MIMO_API_KEY',
  'MINIMAX_API_KEY',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'XAI_API_KEY',
  'ZAI_API_KEY',
] as const

async function importFreshEffortModule() {
  return import(`./effort.ts?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/effort.test.ts')
  for (const key of routingEnvKeys) {
    delete process.env[key]
  }
})

afterEach(() => {
  try {
    mock.restore()
    mock.module('./auth.js', () => realAuth)
    mock.module('./thinking.js', () => realThinking)
    process.env = { ...originalEnv }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('getDefaultEffortForModel — default-Opus effort gate (#1769)', () => {
  test('Pro sessions on the default Opus (now 4.8) get medium effort', async () => {
    process.env.USER_TYPE = 'external'
    mock.module('./auth.js', () => ({
      ...realAuth,
      isProSubscriber: () => true,
      isMaxSubscriber: () => false,
      isTeamSubscriber: () => false,
    }))
    // Keep the ultrathink path out of the way so the opus branch is what's tested.
    mock.module('./thinking.js', () => ({
      ...realThinking,
      isUltrathinkEnabled: () => false,
    }))

    const { getDefaultEffortForModel } = await importFreshEffortModule()

    // Pre-fix this returned undefined because the branch only matched opus-4-6.
    expect(getDefaultEffortForModel('claude-opus-4-8')).toBe('medium')
    expect(getDefaultEffortForModel('claude-opus-4-7')).toBe('medium')
    expect(getDefaultEffortForModel('claude-opus-4-6')).toBe('medium')
    // Control: a non-default Opus does NOT get the medium default (proves the
    // result comes from the model match, not isProSubscriber alone).
    expect(getDefaultEffortForModel('claude-opus-4-1')).toBeUndefined()
  })
})

describe('CLAUDE_CODE_ALWAYS_ENABLE_EFFORT precedence', () => {
  test('keeps API-rejecting Claude models excluded across every public effort predicate', async () => {
    process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = '1'

    const {
      modelSupportsEffort,
      modelSupportsShimReasoningEffort,
      modelSupportsWireEffort,
      resolveAppliedEffort,
      resolveModelReasoningControl,
    } = await importFreshEffortModule()
    const context = {
      apiProvider: 'firstParty' as const,
      routeId: 'anthropic',
      useRuntimeFallback: false,
    }
    const rejectedModels = [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-haiku-20241022',
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-5-20250929',
      'claude-opus-4-20250514',
      'claude-opus-4-1-20250805',
      'claude-haiku-4-5-20251001',
    ]

    for (const model of rejectedModels) {
      expect(resolveModelReasoningControl(model, context)).toMatchObject({
        supportsReasoning: false,
        controllable: false,
        source: 'none',
      })
      expect(modelSupportsEffort(model, context)).toBe(false)
      expect(
        modelSupportsShimReasoningEffort(
          model,
          undefined,
          undefined,
          context,
        ),
      ).toBe(false)
      expect(modelSupportsWireEffort(model, context)).toBe(false)
      expect(resolveAppliedEffort(model, 'medium', context)).toBeUndefined()
    }
  })

  test('preserves supported Claude controls and selected wire values', async () => {
    process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = '1'

    const {
      modelSupportsEffort,
      modelSupportsShimReasoningEffort,
      modelSupportsWireEffort,
      resolveAppliedEffort,
    } = await importFreshEffortModule()
    const context = {
      apiProvider: 'firstParty' as const,
      routeId: 'anthropic',
      useRuntimeFallback: false,
    }
    const supportedModels = [
      ['claude-opus-4-5-20251101', 'low', 'low'],
      ['claude-opus-4-6', 'max', 'max'],
      ['claude-opus-4-8', 'xhigh', 'xhigh'],
      ['claude-sonnet-4-6', 'max', 'high'],
    ] as const

    for (const [model, selected, expected] of supportedModels) {
      expect(modelSupportsEffort(model, context)).toBe(true)
      expect(
        modelSupportsShimReasoningEffort(
          model,
          undefined,
          undefined,
          context,
        ),
      ).toBe(true)
      expect(modelSupportsWireEffort(model, context)).toBe(true)
      expect(resolveAppliedEffort(model, selected, context)).toBe(expected)
    }
  })

  test('only force-enables unresolved custom models beyond their provider fallback', async () => {
    const {
      modelSupportsEffort,
      modelSupportsShimReasoningEffort,
      modelSupportsWireEffort,
      resolveAppliedEffort,
    } = await importFreshEffortModule()
    const model = 'gateway-custom-model'
    const context = {
      apiProvider: 'openai' as const,
      routeId: 'custom',
      useRuntimeFallback: false,
    }
    const support = () => [
      modelSupportsEffort(model, context),
      modelSupportsShimReasoningEffort(
        model,
        undefined,
        undefined,
        context,
      ),
      modelSupportsWireEffort(model, context),
    ]

    delete process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT
    expect(support()).toEqual([false, false, false])
    expect(resolveAppliedEffort(model, 'medium', context)).toBeUndefined()

    process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = '1'
    expect(support()).toEqual([true, true, true])
    expect(resolveAppliedEffort(model, 'medium', context)).toBe('medium')
  })
})

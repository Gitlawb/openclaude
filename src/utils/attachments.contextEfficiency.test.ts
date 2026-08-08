import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { feature } from 'bun:bundle'
import type { Message } from '../types/message.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { createUserMessage } from './messages.js'
import {
  getContextEfficiencyAttachment,
  getSnipNudgeRepeatInterval,
  getSnipNudgeStartThreshold,
} from './attachments.js'

const historySnipTest = feature('HISTORY_SNIP') ? test : test.skip

const ENV_KEYS = [
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'USER_TYPE',
  'DISABLE_COMPACT',
  'DISABLE_AUTO_COMPACT',
] as const

const SAVED_ENV = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = SAVED_ENV[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearTestEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

function useZaiGlmRuntime(): void {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_MODEL = 'glm-5.2'
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/attachments.contextEfficiency.test.ts')
  clearTestEnv()
})

afterEach(() => {
  try {
    restoreEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

function userMessage(estimatedTokens: number): Message {
  return createUserMessage({ content: 'x'.repeat(estimatedTokens * 4) })
}

describe('snip nudge policy', () => {
  test('keeps GLM-5.2 nudges out of mid-sized generic-model ranges', () => {
    useZaiGlmRuntime()

    expect(getSnipNudgeStartThreshold('glm-5.2')).toBeGreaterThan(500_000)
    expect(getSnipNudgeRepeatInterval('glm-5.2')).toBeGreaterThan(50_000)
  })

  test('keeps small effective windows eligible for early nudges', () => {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '40000'

    expect(getSnipNudgeStartThreshold('claude-sonnet-4')).toBe(10_000)
    expect(getSnipNudgeRepeatInterval('claude-sonnet-4')).toBe(10_000)
  })
})

describe('getContextEfficiencyAttachment', () => {
  historySnipTest(
    'does not nudge GLM-5.2 below the model-aware pressure threshold',
    () => {
      useZaiGlmRuntime()

      expect(
        getContextEfficiencyAttachment([userMessage(200_000)], 'glm-5.2'),
      ).toEqual([])
    },
  )

  historySnipTest(
    'nudges small effective windows once above pressure threshold and repeat interval',
    () => {
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '40000'

      expect(
        getContextEfficiencyAttachment([userMessage(12_000)], 'claude-sonnet-4'),
      ).toEqual([{ type: 'context_efficiency' }])
    },
  )
})

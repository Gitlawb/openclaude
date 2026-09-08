import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import * as realCheck1mAccess from './check1mAccess.js'
import { getUpgradeMessage } from './contextWindowUpgradeCheck.js'

const originalSonnetEnv = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
const originalOpusEnv = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
const originalModelEnv = process.env.ANTHROPIC_MODEL
const originalDisable1mEnv = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

beforeEach(async () => {
  await acquireSharedMutationLock('utils/model/contextWindowUpgradeCheck.test.ts')
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  delete process.env.ANTHROPIC_MODEL
  delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  mock.module('./check1mAccess.js', () => ({
    ...realCheck1mAccess,
    checkSonnet1mAccess: () => true,
    checkOpus1mAccess: () => true,
  }))
})

afterEach(() => {
  try {
    mock.restore()
    mock.module('./check1mAccess.js', () => realCheck1mAccess)
    if (originalSonnetEnv !== undefined) {
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = originalSonnetEnv
    } else {
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    }
    if (originalOpusEnv !== undefined) {
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = originalOpusEnv
    } else {
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
    }
    if (originalModelEnv !== undefined) {
      process.env.ANTHROPIC_MODEL = originalModelEnv
    } else {
      delete process.env.ANTHROPIC_MODEL
    }
    if (originalDisable1mEnv !== undefined) {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = originalDisable1mEnv
    } else {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    }
  } finally {
    releaseSharedMutationLock()
  }
})

test('suppresses 1M upgrade message when model defaults to unconditional 1M (Claude 5)', () => {
  process.env.ANTHROPIC_MODEL = 'sonnet'
  expect(getUpgradeMessage('warning')).toBeNull()
  expect(getUpgradeMessage('tip')).toBeNull()

  process.env.ANTHROPIC_MODEL = 'opus'
  expect(getUpgradeMessage('warning')).toBeNull()
  expect(getUpgradeMessage('tip')).toBeNull()
})

test('offers 1M upgrade message when model is pinned to an opt-in 1M version', () => {
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-4-6'
  process.env.ANTHROPIC_MODEL = 'sonnet'

  expect(getUpgradeMessage('warning')).toBe('/model sonnet[1m]')
  expect(getUpgradeMessage('tip')).toContain('Sonnet 1M with 5x more context')
})

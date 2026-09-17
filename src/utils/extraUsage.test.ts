import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realAuth from './auth.js'
import { isBilledAsExtraUsage } from './extraUsage.js'

beforeEach(async () => {
  await acquireSharedMutationLock('utils/extraUsage.test.ts')
  delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  mock.module('./auth.js', () => ({
    ...realAuth,
    isClaudeAISubscriber: () => true,
  }))
})

afterEach(() => {
  try {
    mock.restore()
    mock.module('./auth.js', () => realAuth)
  } finally {
    releaseSharedMutationLock()
  }
})

// Regression for #1769: when Opus is pinned to 4.8/4.7 (where 1M is an opt-in),
// the extra-usage label must cover opus-4-8/4-7 1M variants.
test('1M Opus 4.8/4.7 variants are billed as extra usage when 1M is an opt-in', () => {
  expect(isBilledAsExtraUsage('claude-opus-4-8[1m]', false, false)).toBe(true)
  expect(isBilledAsExtraUsage('claude-opus-4-7[1m]', false, false)).toBe(true)
  expect(isBilledAsExtraUsage('claude-opus-4-6[1m]', false, false)).toBe(true)

  const originalOpus = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  try {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-4-8'
    expect(isBilledAsExtraUsage('opus[1m]', false, false)).toBe(true)
  } finally {
    if (originalOpus !== undefined) {
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = originalOpus
    } else {
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
    }
  }
})

test('Claude 5 models with default 1M context are not billed as extra usage', () => {
  expect(isBilledAsExtraUsage('claude-opus-5', false, false)).toBe(false)
  expect(isBilledAsExtraUsage('claude-opus-5[1m]', false, false)).toBe(false)
  expect(isBilledAsExtraUsage('claude-sonnet-5', false, false)).toBe(false)
  expect(isBilledAsExtraUsage('claude-sonnet-5[1m]', false, false)).toBe(false)
  expect(isBilledAsExtraUsage('sonnet', false, false)).toBe(false)
  expect(isBilledAsExtraUsage('sonnet[1m]', false, false)).toBe(false)
  expect(isBilledAsExtraUsage('opus', false, false)).toBe(false)
  expect(isBilledAsExtraUsage('opus[1m]', false, false)).toBe(false)
})

test('1M Opus is not billed as extra when the Opus 1M merge is enabled', () => {
  expect(isBilledAsExtraUsage('claude-opus-4-8[1m]', false, true)).toBe(false)
  expect(isBilledAsExtraUsage('claude-opus-4-7[1m]', false, true)).toBe(false)
  expect(isBilledAsExtraUsage('opus[1m]', false, true)).toBe(false)
})

test('non-1M models are not billed as extra usage', () => {
  expect(isBilledAsExtraUsage('claude-opus-4-8', false, false)).toBe(false)
})

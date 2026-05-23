import { describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realTokenEstimation from '../services/tokenEstimation.js'

async function loadAnalyzeContextForTesting() {
  return import(`./analyzeContext.js?ts=${Date.now()}-${Math.random()}`)
}

describe('approximateMessageTokens', () => {
  test('counts inline user image blocks as attachments/media', async () => {
    await acquireSharedMutationLock('analyzeContext.messageBreakdown.test.ts')
    const originalFixtureRoot = process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'openclaude-vcr-'))
    process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixtureRoot

    try {
      const { approximateMessageTokensForTesting } =
        await loadAnalyzeContextForTesting()
      const breakdown = await approximateMessageTokensForTesting([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'abc123',
                },
              },
              { type: 'text', text: 'hello' },
            ],
          },
        },
      ])

      expect(breakdown.attachmentTokens).toBe(2_000)
      expect(breakdown.attachmentsByType.get('image')).toBe(2_000)
      expect(breakdown.userMessageTokens).toBeGreaterThan(0)
    } finally {
      if (originalFixtureRoot === undefined) {
        delete process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT
      } else {
        process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = originalFixtureRoot
      }
      await rm(fixtureRoot, { recursive: true, force: true })
      releaseSharedMutationLock()
    }
  })

  test('uses local message estimates when provider token counters are unavailable', async () => {
    await acquireSharedMutationLock('analyzeContext.messageBreakdown.test.ts')
    const originalFixtureRoot = process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'openclaude-vcr-'))
    process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixtureRoot

    try {
      const countMessagesTokensWithAPI = mock(async () => null)
      const countTokensViaHaikuFallback = mock(async () => null)
      mock.module('../services/tokenEstimation.js', () => ({
        ...realTokenEstimation,
        countMessagesTokensWithAPI,
        countTokensViaHaikuFallback,
      }))

      const { approximateMessageTokensForTesting } =
        await loadAnalyzeContextForTesting()
      const breakdown = await approximateMessageTokensForTesting([
        {
          type: 'user',
          message: {
            role: 'user',
            content: 'hello from an environment with no token counter',
          },
        },
      ])

      expect(countMessagesTokensWithAPI).toHaveBeenCalled()
      expect(countTokensViaHaikuFallback).toHaveBeenCalled()
      expect(breakdown.totalTokens).toBeGreaterThan(0)
      expect(breakdown.userMessageTokens).toBeGreaterThan(0)
    } finally {
      mock.restore()
      if (originalFixtureRoot === undefined) {
        delete process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT
      } else {
        process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = originalFixtureRoot
      }
      await rm(fixtureRoot, { recursive: true, force: true })
      releaseSharedMutationLock()
    }
  })

  test('uses media-aware estimates instead of serialized base64 length', async () => {
    await acquireSharedMutationLock('analyzeContext.messageBreakdown.test.ts')
    const originalFixtureRoot = process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'openclaude-vcr-'))
    process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixtureRoot

    try {
      const { approximateMessageTokensForTesting } =
        await loadAnalyzeContextForTesting()
      const breakdown = await approximateMessageTokensForTesting([
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'a'.repeat(80_000),
                },
              },
            ],
          },
        },
      ])

      expect(breakdown.attachmentTokens).toBe(2_000)
      expect(breakdown.attachmentsByType.get('image')).toBe(2_000)
    } finally {
      if (originalFixtureRoot === undefined) {
        delete process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT
      } else {
        process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = originalFixtureRoot
      }
      await rm(fixtureRoot, { recursive: true, force: true })
      releaseSharedMutationLock()
    }
  })
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

import { getHardcodedTeammateModelFallback } from './teammateModel.js'

let previousEnv: NodeJS.ProcessEnv

beforeEach(async () => {
  await acquireSharedMutationLock('utils/swarm/teammateModel.test.ts')
  previousEnv = process.env
  process.env = {}
})

afterEach(() => {
  process.env = previousEnv
  releaseSharedMutationLock()
})

test('getHardcodedTeammateModelFallback returns a Mistral fallback in mistral mode', () => {
  process.env.CLAUDE_CODE_USE_MISTRAL = '1'

  expect(getHardcodedTeammateModelFallback()).toBe('devstral-latest')
})

test('getHardcodedTeammateModelFallback returns the current default Opus (5) for first party', () => {
  // Regression for #1769: the fallback hardcoded Opus 4.6 while the default Opus
  // moved on, so new teammates spawned on an older model. First party now
  // defaults to Opus 5; 3P stays on the Opus 4.8 ids until it rolls out there.
  expect(getHardcodedTeammateModelFallback()).toBe('claude-opus-5')
})

test('getHardcodedTeammateModelFallback distinguishes custom Anthropic endpoints', () => {
  process.env.ANTHROPIC_BASE_URL = 'https://example.com/anthropic'
  expect(getHardcodedTeammateModelFallback()).toBe('claude-opus-4-8')

  process.env.ANTHROPIC_MODEL = 'custom-claude-model'
  expect(getHardcodedTeammateModelFallback()).toBe('custom-claude-model')

  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'custom-opus-model'
  expect(getHardcodedTeammateModelFallback()).toBe('custom-opus-model')
})

test('getHardcodedTeammateModelFallback is provider-aware (Bedrock gets the Opus 4.8 Bedrock id)', () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'

  expect(getHardcodedTeammateModelFallback()).toBe(
    'us.anthropic.claude-opus-4-8-v1',
  )
})

test('getHardcodedTeammateModelFallback returns the Codex default (GPT-5.6 Sol) for codex', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
  process.env.OPENAI_MODEL = 'gpt-5.6-sol'

  expect(getHardcodedTeammateModelFallback()).toBe('gpt-5.6-sol')
})

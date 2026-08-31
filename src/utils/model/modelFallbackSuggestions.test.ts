import { afterEach, beforeEach, expect, test } from 'bun:test'

import { get3PModelFallbackSuggestion } from '../../services/api/errors.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getModelStrings } from './modelStrings.js'
import { get3PFallbackSuggestion } from './validateModel.js'

let previousEnv: NodeJS.ProcessEnv

beforeEach(async () => {
  await acquireSharedMutationLock('utils/model/modelFallbackSuggestions.test.ts')
  previousEnv = process.env
  process.env = {}
})

afterEach(() => {
  try {
    process.env = previousEnv
  } finally {
    releaseSharedMutationLock()
  }
})

const FALLBACK_PATHS = [
  ['validation', get3PFallbackSuggestion],
  ['API error', get3PModelFallbackSuggestion],
] as const

test.each(FALLBACK_PATHS)(
  '%s fallback handles valid Claude 5 variants without accepting near matches',
  (_path, getFallback) => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://example.com/v1'

    const models = getModelStrings()
    expect(getFallback('claude-opus-5')).toBe(models.opus48)
    expect(getFallback('us.anthropic.claude-opus-5-v1:0')).toBe(models.opus48)
    expect(getFallback('claude_opus_5')).toBe(models.opus48)
    expect(getFallback('claude-sonnet-5@20260801')).toBe(models.sonnet46)
    expect(getFallback('claude_sonnet_5')).toBe(models.sonnet46)
    expect(getFallback('claude-opus-50')).toBeUndefined()
    expect(getFallback('claude-sonnet-50')).toBeUndefined()
    expect(getFallback('claude_opus_50')).toBeUndefined()
    expect(getFallback('claude_sonnet_5x')).toBeUndefined()
  },
)

test.each(FALLBACK_PATHS)(
  '%s fallback is disabled for the first-party provider',
  (_path, getFallback) => {
    expect(getFallback('claude-opus-5')).toBeUndefined()
    expect(getFallback('claude-sonnet-5')).toBeUndefined()
  },
)

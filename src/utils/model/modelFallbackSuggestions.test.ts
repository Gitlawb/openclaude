import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  resetModelStringsForTestingOnly,
  setModelStrings,
} from 'src/bootstrap/state.js'
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
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  try {
    resetModelStringsForTestingOnly()
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
  '%s fallback provides provider-specific Claude 5 mappings for Bedrock, Vertex, and Foundry',
  (_path, getFallback) => {
    // Bedrock default
    process.env = { CLAUDE_CODE_USE_BEDROCK: '1' }
    resetModelStringsForTestingOnly()
    let models = getModelStrings()
    expect(getFallback('claude-opus-5')).toBe(models.opus48)
    expect(models.opus48).toBe('us.anthropic.claude-opus-4-8-v1')
    expect(getFallback('claude-sonnet-5')).toBe(models.sonnet46)
    expect(models.sonnet46).toBe('us.anthropic.claude-sonnet-4-6')

    // Vertex
    process.env = { CLAUDE_CODE_USE_VERTEX: '1' }
    resetModelStringsForTestingOnly()
    models = getModelStrings()
    expect(getFallback('claude-opus-5')).toBe(models.opus48)
    expect(models.opus48).toBe('claude-opus-4-8')
    expect(getFallback('claude-sonnet-5')).toBe(models.sonnet46)
    expect(models.sonnet46).toBe('claude-sonnet-4-6')

    // Foundry
    process.env = { CLAUDE_CODE_USE_FOUNDRY: '1' }
    resetModelStringsForTestingOnly()
    models = getModelStrings()
    expect(getFallback('claude-opus-5')).toBe(models.opus48)
    expect(models.opus48).toBe('claude-opus-4-8')
    expect(getFallback('claude-sonnet-5')).toBe(models.sonnet46)
    expect(models.sonnet46).toBe('claude-sonnet-4-6')
  },
)

test.each(FALLBACK_PATHS)(
  '%s fallback honors Bedrock inference profiles when present',
  (_path, getFallback) => {
    process.env = { CLAUDE_CODE_USE_BEDROCK: '1' }
    resetModelStringsForTestingOnly()
    const customProfileOpus =
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-4-8'
    const customProfileSonnet =
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6'
    const models = {
      ...getModelStrings(),
      opus48: customProfileOpus,
      sonnet46: customProfileSonnet,
    }
    setModelStrings(models)
    expect(getFallback('claude-opus-5')).toBe(customProfileOpus)
    expect(getFallback('claude-sonnet-5')).toBe(customProfileSonnet)
  },
)

test.each(FALLBACK_PATHS)(
  '%s fallback is disabled for the first-party provider',
  (_path, getFallback) => {
    expect(getFallback('claude-opus-5')).toBeUndefined()
    expect(getFallback('claude-sonnet-5')).toBeUndefined()
  },
)

import { expect, test } from 'bun:test'

import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
  modelHasUnconditional1MContext,
} from '../context.js'
import { MODEL_COSTS } from '../modelCost.js'
import { modelSupportsAdaptiveThinking } from '../thinking.js'
import { isValidAdvisorModel, modelSupportsAdvisor } from '../advisor.js'
import { isFastModeSupportedByModel } from '../fastMode.js'
import {
  isClaude5ModelId,
  isOpus5ModelId,
  isSonnet5ModelId,
} from './modelIdMatch.js'
import { getAllModelBetas } from '../betas.js'
import { CONTEXT_1M_BETA_HEADER } from '../../constants/betas.js'
import { firstPartyNameToCanonical } from './model.js'
import {
  CANONICAL_MODEL_IDS,
  CLAUDE_OPUS_5_CONFIG,
  CLAUDE_SONNET_5_CONFIG,
} from './configs.js'

// Opus 5 and Sonnet 5 support. Before this change the Claude catalog stopped at
// Opus 4.8 / Sonnet 4.6, so every assertion below failed: canonicalization fell
// through to the generic Claude branches, the models had no pricing entry, and
// they were classified as non-adaptive (which sends the removed `budget_tokens`
// field and returns HTTP 400).

test('registers Opus 5 and Sonnet 5 as canonical first-party models', () => {
  expect(CANONICAL_MODEL_IDS).toContain('claude-opus-5')
  expect(CANONICAL_MODEL_IDS).toContain('claude-sonnet-5')
  expect(CLAUDE_OPUS_5_CONFIG.firstParty).toBe('claude-opus-5')
  expect(CLAUDE_SONNET_5_CONFIG.firstParty).toBe('claude-sonnet-5')
})

test.each([
  ['claude-opus-5', 'claude-opus-5'],
  ['claude-sonnet-5', 'claude-sonnet-5'],
  ['claude-opus-5[1m]', 'claude-opus-5'],
  ['claude-sonnet-5[1m]', 'claude-sonnet-5'],
  ['claude-opus-5?reasoning=high', 'claude-opus-5'],
  ['us.anthropic.claude-opus-5-v1:0', 'claude-opus-5'],
  ['claude-opus-5@20260501', 'claude-opus-5'],
  ['anthropic/claude-sonnet-5', 'claude-sonnet-5'],
])('canonicalizes %s to %s', (model, canonical) => {
  expect(firstPartyNameToCanonical(model)).toBe(canonical)
})

// Boundary matching, adopted from the approach in closed PR #2049. A plain
// substring check would fold these near-matches into the Opus 5 / Sonnet 5
// entries and hand them that model's pricing and capabilities.
test.each([
  ['claude-opus-50', 'claude-opus-5'],
  ['claude-opus-5x', 'claude-opus-5'],
  ['claude-sonnet-50', 'claude-sonnet-5'],
  ['claude-sonnet-5x', 'claude-sonnet-5'],
])('does not canonicalize near-match %s as %s', (model, canonical) => {
  expect(firstPartyNameToCanonical(model)).not.toBe(canonical)
})

test('prices Opus 5 at $5/$25 and Sonnet 5 at $2/$10 per Mtok', () => {
  const opus5 = MODEL_COSTS['claude-opus-5']
  const sonnet5 = MODEL_COSTS['claude-sonnet-5']

  expect(opus5).toBeDefined()
  expect(opus5?.inputTokens).toBe(5)
  expect(opus5?.outputTokens).toBe(25)

  expect(sonnet5).toBeDefined()
  expect(sonnet5?.inputTokens).toBe(2)
  expect(sonnet5?.outputTokens).toBe(10)
})

test('prices Sonnet 5 below Sonnet 4.6', () => {
  // Sonnet 5 is the cheaper model of the two; a copied 3/15 tier would make the
  // upgrade look like a price increase in the picker's pricing suffix.
  const sonnet5 = MODEL_COSTS['claude-sonnet-5']
  const sonnet46 = MODEL_COSTS['claude-sonnet-4-6']

  expect(sonnet5?.inputTokens).toBeLessThan(sonnet46?.inputTokens ?? 0)
  expect(sonnet5?.outputTokens).toBeLessThan(sonnet46?.outputTokens ?? 0)
})

test.each(['claude-opus-5', 'claude-sonnet-5'])(
  'treats %s as an adaptive-thinking model',
  model => {
    expect(modelSupportsAdaptiveThinking(model)).toBe(true)
  },
)

// claude.ts registers Opus 5 / Sonnet 5 / Opus 4.8 with contextWindow:
// 1_000_000, but before this change getContextWindowForModel() never read
// that value for regular (non-"ant") users: it required either the [1m]
// suffix or a growthbook-gated experiment scoped to sonnet-4-6 only, so the
// UI reported a 200K window (and the API request never carried the 1M beta
// header) for the plain model id.
test.each(['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8'])(
  'treats %s as unconditionally 1M-context',
  model => {
    expect(modelHasUnconditional1MContext(model)).toBe(true)
    expect(getContextWindowForModel(model)).toBe(1_000_000)
    expect(getAllModelBetas(model)).toContain(CONTEXT_1M_BETA_HEADER)
  },
)

test.each(['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7'])(
  'does not treat %s as unconditionally 1M-context',
  model => {
    expect(modelHasUnconditional1MContext(model)).toBe(false)
  },
)

// The catalog descriptors declare maxOutputTokens: 128_000 for both Claude 5
// models. The native resolver keeps its own family branches, so without an
// entry there they fell through to the generic {32k, 64k} limit — silently
// capping requests and every thinking/output budget derived from it.
test.each([
  ['claude-opus-5', 64_000, 128_000],
  ['claude-sonnet-5', 32_000, 128_000],
])('resolves %s output limits to the declared 128k ceiling', (
  model,
  defaultTokens,
  upperLimit,
) => {
  expect(getModelMaxOutputTokens(model)).toEqual({
    default: defaultTokens,
    upperLimit,
  })
})

test('a Claude 5 near match keeps the generic output limits', () => {
  expect(getModelMaxOutputTokens('claude-opus-50')).toEqual({
    default: 32_000,
    upperLimit: 64_000,
  })
})

// One boundary-aware matcher backs every Claude 5 decision. These pin the
// matcher itself against the id spellings the providers actually emit.
test.each([
  'claude-opus-5',
  'claude-opus-5-20260501',
  'claude-opus-5[1m]',
  'claude-opus-5?reasoning=high',
  'us.anthropic.claude-opus-5-v1:0',
  'claude-opus-5@20260501',
])('recognizes %s as Opus 5', model => {
  expect(isOpus5ModelId(model)).toBe(true)
  expect(isClaude5ModelId(model)).toBe(true)
  expect(isSonnet5ModelId(model)).toBe(false)
})

test.each([
  'claude-sonnet-5',
  'claude-sonnet-5-20260501',
  'anthropic/claude-sonnet-5',
])('recognizes %s as Sonnet 5', model => {
  expect(isSonnet5ModelId(model)).toBe(true)
  expect(isClaude5ModelId(model)).toBe(true)
  expect(isOpus5ModelId(model)).toBe(false)
})

test.each([
  'claude-opus-50',
  'claude-opus-5x',
  'claude-sonnet-50',
  'claude-sonnet-5x',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  // Hyphenated spelling only. No provider emits an underscore id, and
  // firstPartyNameToCanonical does not canonicalize one, so accepting it here
  // would grant Claude 5 capabilities to a model with no pricing entry.
  'claude_opus_5',
  'claude_sonnet_5',
])('rejects the near match %s', model => {
  expect(isClaude5ModelId(model)).toBe(false)
})

// A near match must not pick up any Claude 5 capability. Each of these gates a
// different wire-level or UI behavior, and each used to be its own substring
// check.
test.each([
  'claude-opus-50',
  'claude-opus-5x',
  'claude-sonnet-50',
  'claude-sonnet-5x',
])('grants no Claude 5 capability to the near match %s', model => {
  expect(modelSupportsAdaptiveThinking(model)).toBe(false)
  expect(modelHasUnconditional1MContext(model)).toBe(false)
  expect(modelSupportsAdvisor(model)).toBe(false)
  expect(isValidAdvisorModel(model)).toBe(false)
  expect(isFastModeSupportedByModel(model)).toBe(false)
})

test.each(['claude-opus-5', 'claude-sonnet-5'])(
  'grants %s the Claude 5 capabilities',
  model => {
    expect(modelSupportsAdaptiveThinking(model)).toBe(true)
    expect(modelHasUnconditional1MContext(model)).toBe(true)
    expect(modelSupportsAdvisor(model)).toBe(true)
  },
)

test('fast mode covers Opus 5 but not Sonnet 5', () => {
  expect(isFastModeSupportedByModel('claude-opus-5')).toBe(true)
  expect(isFastModeSupportedByModel('claude-sonnet-5')).toBe(false)
})

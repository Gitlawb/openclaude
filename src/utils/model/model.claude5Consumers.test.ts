import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { buildCurrentProviderSummary } from '../../commands/provider/provider.js'
import { detectProvider } from '../../components/StartupScreen.js'
import { MODEL_COSTS } from '../modelCost.js'
import {
  firstPartyNameToCanonical,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getMarketingNameForModel,
  isNonCustomOpusModel,
} from './model.js'
import { getMaxSonnetOption } from './modelOptions.js'
import { getModelStrings } from './modelStrings.js'
import { isClaude5ModelId } from './modelIdMatch.js'

// Consumers of the contracts this cohort changed: first-party default
// resolution, accepted Claude 5 ID spellings, and built-in Opus policy
// membership. Each of these read a historical literal or a stale registry and
// so disagreed with the resolver after the default moved.

const ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'CLAUDE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/model/model.claude5Consumers.test.ts')
  clearEnv()
})

afterEach(() => {
  try {
    clearEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

// --- first-party Sonnet fallbacks -----------------------------------------

// The row's value is the `sonnet` alias, which now resolves to Sonnet 5 on
// first party. A literal label here runs Sonnet 5 under a Sonnet 4.6 name.
test('the Max/Team sonnet row is labelled with the model that alias resolves to', () => {
  const marketingName = getMarketingNameForModel(getDefaultSonnetModel())

  const option = getMaxSonnetOption()
  expect(option.value).toBe('sonnet')
  expect(marketingName).toBeDefined()
  expect(option.description).toContain(marketingName as string)
})

// With nothing configured, both display surfaces must name the model the
// request path selects.
test('the startup display falls back to the resolved default Sonnet', () => {
  expect(detectProvider().model).toBe(getDefaultSonnetModel())
})

test('the provider summary falls back to the resolved default Sonnet', () => {
  const summary = buildCurrentProviderSummary({
    processEnv: {} as NodeJS.ProcessEnv,
    persisted: null,
  })
  expect(summary.modelLabel).toBe(getDefaultSonnetModel())
})

test('an explicitly configured model still wins over the default', () => {
  process.env.ANTHROPIC_MODEL = 'claude-opus-4-6'
  expect(detectProvider().model).toBe('claude-opus-4-6')
})

// --- accepted Claude 5 ID spellings ---------------------------------------

// The capability matcher and canonicalization must accept the same inputs: an
// ID that gets Claude 5 capabilities but no canonical identity is priced by the
// unknown-model path.
test.each(['claude_opus_5', 'claude_sonnet_5'])(
  'the underscore spelling %s is not a Claude 5 identity anywhere',
  model => {
    expect(isClaude5ModelId(model)).toBe(false)
    expect(MODEL_COSTS[firstPartyNameToCanonical(model)]).toBeUndefined()
  },
)

test.each([
  ['claude-opus-5', 'claude-opus-5'],
  ['claude-sonnet-5', 'claude-sonnet-5'],
])(
  'the hyphenated spelling %s is a Claude 5 identity with pricing',
  (model, canonical) => {
    expect(isClaude5ModelId(model)).toBe(true)
    expect(firstPartyNameToCanonical(model)).toBe(canonical)
    expect(MODEL_COSTS[canonical]).toBeDefined()
  },
)

test.each(['claude-opus-50', 'claude-sonnet-5x'])(
  'the near match %s is neither a Claude 5 identity nor priced as one',
  model => {
    expect(isClaude5ModelId(model)).toBe(false)
    expect(MODEL_COSTS[firstPartyNameToCanonical(model)]).toBeUndefined()
  },
)

// --- built-in Opus policy membership --------------------------------------

// isNonCustomOpusModel gates the subscriber invalid-model remediation
// (services/api/errors.ts), the non-subscriber off-switch (services/api/
// claude.ts), and the consecutive-529 fallback (services/api/withRetry.ts).
// A manual registry that stops at the previous default silently drops the new
// default out of all three.
test('the resolved default Opus is a built-in Opus', () => {
  expect(isNonCustomOpusModel(getDefaultOpusModel())).toBe(true)
  expect(isNonCustomOpusModel(getModelStrings().opus5)).toBe(true)
})

test.each(['opus40', 'opus41', 'opus45', 'opus46', 'opus47', 'opus48', 'opus5'])(
  'the built-in %s stays a non-custom Opus',
  key => {
    expect(
      isNonCustomOpusModel(
        getModelStrings()[key as keyof ReturnType<typeof getModelStrings>],
      ),
    ).toBe(true)
  },
)

test('an arbitrary custom Opus override is still excluded', () => {
  expect(isNonCustomOpusModel('my-proxy/opus-turbo')).toBe(false)
  expect(isNonCustomOpusModel('claude-opus-50')).toBe(false)
})

import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { buildCurrentProviderSummary } from '../../commands/provider/provider.js'
import { detectProvider } from '../../components/StartupScreen.js'
import { MODEL_COSTS } from '../modelCost.js'
import { STARTUP_PROVIDER_OVERRIDE_ENV_KEYS } from '../providerStartupOverrides.js'
import {
  firstPartyNameToCanonical,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getMarketingNameForModel,
  isNonCustomOpusModel,
} from './model.js'
import {
  getMaxSonnetOption,
  getOpus46_1MOption,
  getSonnet46_1MOption,
} from './modelOptions.js'
import { getModelStrings } from './modelStrings.js'
import { isClaude5ModelId } from './modelIdMatch.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'

// Consumers of the contracts this cohort changed: first-party default
// resolution, accepted Claude 5 ID spellings, and built-in Opus policy
// membership. Each of these read a historical literal or a stale registry and
// so disagreed with the resolver after the default moved.

const ENV_KEYS = [
  ...STARTUP_PROVIDER_OVERRIDE_ENV_KEYS,
  'CLAUDE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/model/model.claude5Consumers.test.ts')
  clearEnv()
  setSessionSettingsCache({ settings: {}, errors: [] })
})

afterEach(() => {
  try {
    clearEnv()
    resetSettingsCache()
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

test('a persisted settings model override still wins over the default', () => {
  setSessionSettingsCache({
    settings: { model: 'claude-opus-4-6' },
    errors: [],
  })
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

test.each([
  'claude-opus-50',
  'claude-sonnet-5x',
  'arbitrary-proxy-opus-5',
  'arbitrary-proxy-sonnet-5',
])(
  'the near match %s is neither a Claude 5 identity nor priced as one',
  model => {
    expect(isClaude5ModelId(model)).toBe(false)
    expect(firstPartyNameToCanonical(model)).not.toBe('claude-opus-5')
    expect(firstPartyNameToCanonical(model)).not.toBe('claude-sonnet-5')
    expect(MODEL_COSTS[firstPartyNameToCanonical(model)]).toBeUndefined()
  },
)

test('first-party sonnet alias rows follow ANTHROPIC_DEFAULT_SONNET_MODEL', () => {
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-4-6'
  const resolved = getDefaultSonnetModel()
  const marketingName = getMarketingNameForModel(resolved)

  expect(resolved).toBe('claude-sonnet-4-6')
  expect(marketingName).toBe('Sonnet 4.6')

  const maxRow = getMaxSonnetOption()
  expect(maxRow.value).toBe('sonnet')
  expect(maxRow.description).toContain('Sonnet 4.6')
  expect(maxRow.description).not.toContain('Sonnet 5')

  const oneM = getSonnet46_1MOption()
  expect(oneM.value).toBe('sonnet[1m]')
  expect(oneM.description).toContain('Sonnet 4.6')
  expect(oneM.description).not.toContain('Sonnet 5')
})

test('first-party opus alias rows follow ANTHROPIC_DEFAULT_OPUS_MODEL', () => {
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-4-6'
  const resolved = getDefaultOpusModel()
  const marketingName = getMarketingNameForModel(resolved)

  expect(resolved).toBe('claude-opus-4-6')
  expect(marketingName).toBe('Opus 4.6')

  const oneM = getOpus46_1MOption()
  expect(oneM.value).toBe('opus[1m]')
  expect(oneM.description).toContain('Opus 4.6')
  expect(oneM.description).not.toContain('Opus 5')
})

test('the provider summary prefers the injected Sonnet default over the global one', () => {
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-4-6'
  const summary = buildCurrentProviderSummary({
    processEnv: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5',
    } as NodeJS.ProcessEnv,
    persisted: null,
  })
  expect(summary.modelLabel).toBe('claude-sonnet-5')
})

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

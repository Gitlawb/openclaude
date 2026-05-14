import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'

// Mock surface: keep the original providerProfiles export shape and only
// override `getProviderProfiles` / `getActiveProviderProfile` /
// `getProfileModelOptions` per test. Anything else (setActiveProviderProfile,
// etc.) stays as the real implementation so we don't break unrelated callers
// loaded in the same `bun test` invocation. See `src/utils/user.test.ts` for
// the canonical pattern; this is the same lesson as the 2026-04-30 mock-leak
// note in lessons_learned.md.
import * as actualProviderProfiles from '../providerProfiles.js'
import * as actualProviders from './providers.js'
import * as actualAuth from '../auth.js'

function buildProviderProfileFixture(
  overrides: Partial<actualProviderProfiles.ProviderProfile> = {},
): actualProviderProfiles.ProviderProfile {
  return {
    id: 'profile_default',
    name: 'Default Profile',
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    model: 'example-model',
    apiKey: 'sk-example',
    ...overrides,
  }
}

async function importFreshModelOptionsModule(
  providerProfilesMock: Partial<typeof actualProviderProfiles>,
) {
  mock.restore()
  mock.module('../providerProfiles.js', () => ({
    ...actualProviderProfiles,
    ...providerProfilesMock,
  }))
  // The 3P path also reads getAPIProvider and a handful of subscriber checks;
  // pin them to a stable 3P-openai shape so the picker exercises the inactive
  // profile branch we care about.
  mock.module('./providers.js', () => ({
    ...actualProviders,
    getAPIProvider: () => 'openai',
    getAPIProviderForStatsig: () => 'openai',
    isFirstPartyAnthropicBaseUrl: () => false,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => false,
  }))
  // Subscriber checks short-circuit the 3P path with a Claude.AI-shaped option
  // list and never reach the inactive-profile append. Pin to non-subscriber
  // for these tests so the openai 3P branch runs end-to-end.
  mock.module('../auth.js', () => ({
    ...actualAuth,
    isClaudeAISubscriber: () => false,
    isMaxSubscriber: () => false,
    isTeamPremiumSubscriber: () => false,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./modelOptions.js?ts=${nonce}`)
}

beforeEach(() => {
  mock.restore()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  mock.restore()
  resetSettingsCache()
  resetModelStringsForTestingOnly()
})

test('parseSwitchProfileValue: round-trips encoded payload', async () => {
  const { encodeSwitchProfileValue, parseSwitchProfileValue } =
    await importFreshModelOptionsModule({})
  const encoded = encodeSwitchProfileValue('profile_kimi_k26', 'kimi-k2.6')
  expect(parseSwitchProfileValue(encoded)).toEqual({
    profileId: 'profile_kimi_k26',
    model: 'kimi-k2.6',
  })
})

test('parseSwitchProfileValue: preserves colons inside model name', async () => {
  // OpenRouter model strings carry `:` segments (`vendor/model:variant`); the
  // parser must split only on the FIRST colon after the prefix so the model
  // half keeps its inner colons. Regression guard against a naive
  // `value.split(':')`.
  const { encodeSwitchProfileValue, parseSwitchProfileValue } =
    await importFreshModelOptionsModule({})
  const encoded = encodeSwitchProfileValue(
    'profile_openrouter',
    'deepseek/deepseek-v4-flash:nitro',
  )
  expect(parseSwitchProfileValue(encoded)).toEqual({
    profileId: 'profile_openrouter',
    model: 'deepseek/deepseek-v4-flash:nitro',
  })
})

test('parseSwitchProfileValue: returns null for plain model strings', async () => {
  const { parseSwitchProfileValue } = await importFreshModelOptionsModule({})
  expect(parseSwitchProfileValue('claude-sonnet-4-6')).toBeNull()
  expect(parseSwitchProfileValue(null)).toBeNull()
  expect(parseSwitchProfileValue('__switch_profile__:')).toBeNull()
  expect(parseSwitchProfileValue('__switch_profile__:only-id:')).toBeNull()
})

test('getInactiveProviderProfileOptions: omits the active profile', async () => {
  const profileA = buildProviderProfileFixture({
    id: 'profile_a',
    name: 'A',
    baseUrl: 'https://a.example.com/v1',
    model: 'a-model',
  })
  const profileB = buildProviderProfileFixture({
    id: 'profile_b',
    name: 'B',
    baseUrl: 'https://b.example.com/v1',
    model: 'b-model',
  })
  const { getInactiveProviderProfileOptions } =
    await importFreshModelOptionsModule({
      getProviderProfiles: () => [profileA, profileB],
      getActiveProviderProfile: () => profileA,
      getProfileModelOptions: profile => [
        { value: profile.model, label: profile.model, description: profile.name },
      ],
    })

  const options = getInactiveProviderProfileOptions('profile_a')
  expect(options).toHaveLength(1)
  expect(options[0]?.switchToProfileId).toBe('profile_b')
  expect(options[0]?.label).toContain('b-model')
  expect(options[0]?.label).toContain('B')
  expect(options[0]?.description).toContain('https://b.example.com/v1')
  expect(typeof options[0]?.value).toBe('string')
  expect(options[0]?.value).toContain('profile_b')
  expect(options[0]?.value).toContain('b-model')
})

test('getInactiveProviderProfileOptions: surfaces all configured profiles when none is active', async () => {
  // Edge: if the caller passes `undefined` (no active profile yet — e.g. on a
  // pristine first-run before env is applied), every configured profile should
  // appear. Guards against a stray `filter` that drops everything when the
  // active id is missing.
  const profileA = buildProviderProfileFixture({
    id: 'profile_a',
    name: 'A',
    model: 'a-model',
  })
  const profileB = buildProviderProfileFixture({
    id: 'profile_b',
    name: 'B',
    model: 'b-model',
  })
  const { getInactiveProviderProfileOptions } =
    await importFreshModelOptionsModule({
      getProviderProfiles: () => [profileA, profileB],
      getActiveProviderProfile: () => null,
      getProfileModelOptions: profile => [
        { value: profile.model, label: profile.model, description: profile.name },
      ],
    })

  const options = getInactiveProviderProfileOptions(undefined)
  expect(options.map(o => o.switchToProfileId)).toEqual([
    'profile_a',
    'profile_b',
  ])
})

test('getInactiveProviderProfileOptions: explodes multi-model profiles into one option per model', async () => {
  // Issue #1119 use case: one OpenRouter profile with several `agentModels`
  // exposed as comma-separated `model`. Each model should become its own
  // picker entry so the user can pick the exact one they want, not just the
  // primary.
  const multi = buildProviderProfileFixture({
    id: 'profile_or',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4-flash:nitro,glm-5.1,MiniMax-M2.5',
  })
  const { getInactiveProviderProfileOptions } =
    await importFreshModelOptionsModule({
      getProviderProfiles: () => [multi],
      getActiveProviderProfile: () => null,
      getProfileModelOptions: () => [
        {
          value: 'deepseek/deepseek-v4-flash:nitro',
          label: 'deepseek/deepseek-v4-flash:nitro',
          description: 'OpenRouter',
        },
        { value: 'glm-5.1', label: 'glm-5.1', description: 'OpenRouter' },
        {
          value: 'MiniMax-M2.5',
          label: 'MiniMax-M2.5',
          description: 'OpenRouter',
        },
      ],
    })
  const options = getInactiveProviderProfileOptions(undefined)
  expect(options).toHaveLength(3)
  expect(options.every(o => o.switchToProfileId === 'profile_or')).toBe(true)
  expect(options.map(o => o.label.split(' · ')[0])).toEqual([
    'deepseek/deepseek-v4-flash:nitro',
    'glm-5.1',
    'MiniMax-M2.5',
  ])
})

test('getModelOptionsBase: 3P path includes inactive profile options when env applied', async () => {
  const active = buildProviderProfileFixture({
    id: 'profile_active',
    name: 'Active',
    baseUrl: 'https://api.kimi.com/coding/',
    model: 'kimi-k2.6',
  })
  const inactive = buildProviderProfileFixture({
    id: 'profile_inactive',
    name: 'GLM',
    baseUrl: 'https://api.z.ai/api/anthropic',
    model: 'glm-5.1',
  })

  const previousFlag = process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
  try {
    const { getModelOptions, parseSwitchProfileValue } =
      await importFreshModelOptionsModule({
        getProviderProfiles: () => [active, inactive],
        getActiveProviderProfile: () => active,
        getProfileModelOptions: profile => [
          { value: profile.model, label: profile.model, description: profile.name },
        ],
      })

    const options = getModelOptions(false)
    const switchOptions = options.filter(o => o.switchToProfileId !== undefined)
    expect(switchOptions.length).toBeGreaterThan(0)
    expect(switchOptions[0]?.switchToProfileId).toBe('profile_inactive')
    const parsed = parseSwitchProfileValue(switchOptions[0]!.value)
    expect(parsed).toEqual({
      profileId: 'profile_inactive',
      model: 'glm-5.1',
    })
  } finally {
    if (previousFlag === undefined) {
      delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    } else {
      process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = previousFlag
    }
  }
})

test('getModelOptionsBase: 3P path omits inactive profile options when env NOT applied', async () => {
  // If the user hasn't gone through `/provider` yet (profile env not applied),
  // surfacing cross-profile switching would be confusing — they haven't opted
  // into the multi-profile workflow at all. Guard against that.
  const inactive = buildProviderProfileFixture({
    id: 'profile_inactive',
    name: 'GLM',
    model: 'glm-5.1',
  })
  const previousFlag = process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  try {
    const { getModelOptions } = await importFreshModelOptionsModule({
      getProviderProfiles: () => [inactive],
      getActiveProviderProfile: () => null,
      getProfileModelOptions: profile => [
        { value: profile.model, label: profile.model, description: profile.name },
      ],
    })
    const options = getModelOptions(false)
    expect(options.every(o => o.switchToProfileId === undefined)).toBe(true)
  } finally {
    if (previousFlag !== undefined) {
      process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = previousFlag
    }
  }
})

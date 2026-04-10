import { expect, test } from 'bun:test'

import {
  buildProviderModelSettingsUpdate,
  getPersistedModelSettingForProvider,
} from './providerModelSettings.js'

test('provider-specific model wins over legacy model', () => {
  const settings = {
    model: 'claude-sonnet-4-6',
    providerModels: {
      codex: 'gpt-5.4?reasoning=xhigh',
    },
  }

  expect(
    getPersistedModelSettingForProvider({
      settings,
      provider: 'codex',
    }),
  ).toBe('gpt-5.4?reasoning=xhigh')
})

test('legacy first-party model does not leak into codex provider', () => {
  expect(
    getPersistedModelSettingForProvider({
      settings: { model: 'claude-sonnet-4-6' },
      provider: 'codex',
    }),
  ).toBeUndefined()
})

test('legacy aliases still work across providers', () => {
  expect(
    getPersistedModelSettingForProvider({
      settings: { model: 'sonnet' },
      provider: 'codex',
    }),
  ).toBe('sonnet')
})

test('update writes provider-specific model and keeps legacy model for compatibility', () => {
  expect(
    buildProviderModelSettingsUpdate({
      provider: 'codex',
      model: 'gpt-5.4?reasoning=xhigh',
    }),
  ).toEqual({
    model: 'gpt-5.4?reasoning=xhigh',
    providerModels: {
      codex: 'gpt-5.4?reasoning=xhigh',
    },
  })
})

test('clearing current provider only removes matching legacy model', () => {
  expect(
    buildProviderModelSettingsUpdate({
      provider: 'codex',
      model: undefined,
      settings: { model: 'claude-sonnet-4-6' },
    }),
  ).toEqual({
    providerModels: {
      codex: undefined,
    },
  })
})

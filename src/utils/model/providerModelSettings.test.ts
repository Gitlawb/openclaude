import { expect, test } from 'bun:test'

import type { SettingsJson } from '../settings/types.js'
import {
  buildProviderModelSettingsUpdate,
  getPersistedEffortSettingForProvider,
  getPersistedModelSettingForProvider,
  resolveProviderSelectionTarget,
} from './providerModelSettings.js'

test('provider target keys can be profile-scoped', () => {
  expect(
    resolveProviderSelectionTarget({
      provider: 'openai',
      profileId: 'provider_123',
    }),
  ).toEqual({
    provider: 'openai',
    targetKey: 'profile:provider_123',
  })
})

test('provider-target selections take precedence over provider and legacy model settings', () => {
  const settings: SettingsJson = {
    model: 'claude-sonnet-4-6',
    providerModels: {
      openai: 'gpt-4o',
    },
    providerTargetSelections: {
      openai: {
        model: 'gpt-5.4',
      },
    },
  }

  expect(
    getPersistedModelSettingForProvider({
      settings,
      provider: 'openai',
    }),
  ).toBe('gpt-5.4')
})

test('provider-target selections fall back to provider model and legacy model compatibility', () => {
  const settings: SettingsJson = {
    model: 'gpt-4o',
    providerModels: {
      openai: 'gpt-5.4',
    },
  }

  expect(
    getPersistedModelSettingForProvider({
      settings,
      provider: 'openai',
    }),
  ).toBe('gpt-5.4')
})

test('provider-target effort settings override the legacy global effort level', () => {
  const settings: SettingsJson = {
    effortLevel: 'low',
    providerTargetSelections: {
      openai: {
        effortLevel: 'high',
      },
    },
  }

  expect(
    getPersistedEffortSettingForProvider({
      settings,
      provider: 'openai',
    }),
  ).toBe('high')

  expect(
    getPersistedEffortSettingForProvider({
      settings,
      provider: 'gemini',
    }),
  ).toBe('low')
})

test('buildProviderModelSettingsUpdate writes provider-target scoped model and effort patches', () => {
  const settings: SettingsJson = {
    model: 'gpt-4o',
    providerModels: {
      openai: 'gpt-4o',
    },
    providerTargetSelections: {
      openai: {
        model: 'gpt-4o',
        effortLevel: 'low',
      },
    },
    effortLevel: 'low',
  }

  const update = buildProviderModelSettingsUpdate({
    settings,
    provider: 'openai',
    targetKey: 'profile:provider_123',
    model: 'gpt-5.4',
    effortLevel: 'high',
  })

  expect(update.model).toBe('gpt-5.4')
  expect(update.effortLevel).toBe('high')
  expect(update.providerModels).toEqual({
    openai: 'gpt-5.4',
  })
  expect(update.providerTargetSelections).toEqual({
    'profile:provider_123': {
      model: 'gpt-5.4',
      effortLevel: 'high',
    },
  })
})

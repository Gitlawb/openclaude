import { afterEach, beforeEach, expect, test } from 'bun:test'

import { enableConfigs } from '../config.js'
import type { SettingsJson } from '../settings/types.js'
import {
  applyPersistedProviderSelectionTarget,
  applyProviderSelectionTarget,
} from './providerTargets.js'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  process.env.NODE_ENV = 'test'
  enableConfigs()
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

test('applyProviderSelectionTarget restores Codex routing from persisted target state', () => {
  const settings: SettingsJson = {
    activeProviderTarget: 'codex',
    providerTargetSelections: {
      codex: {
        model: 'gpt-5.4',
        effortLevel: 'xhigh',
      },
    },
  }

  const target = applyProviderSelectionTarget('codex', settings)

  expect(target?.targetKey).toBe('codex')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(process.env.OPENAI_MODEL).toBe('gpt-5.4')
})

test('applyPersistedProviderSelectionTarget overrides launcher defaults with first-party selection', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-5.4'

  const target = applyPersistedProviderSelectionTarget({
    activeProviderTarget: 'firstParty',
    providerTargetSelections: {
      firstParty: {
        model: 'claude-sonnet-4-6',
      },
    },
  })

  expect(target?.targetKey).toBe('firstParty')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(process.env.OPENAI_MODEL).toBeUndefined()
  expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
  expect(process.env.CLAUDE_CODE_USE_GITHUB).toBeUndefined()
})

test('applyPersistedProviderSelectionTarget skips restore when provider routing is host-managed', () => {
  process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-5.4'

  const target = applyPersistedProviderSelectionTarget({
    activeProviderTarget: 'firstParty',
    providerTargetSelections: {
      firstParty: {
        model: 'claude-sonnet-4-6',
      },
    },
  })

  expect(target).toBeUndefined()
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(process.env.OPENAI_MODEL).toBe('gpt-5.4')
})

test('applyPersistedProviderSelectionTarget can force restore in host-managed sessions', () => {
  process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'

  const target = applyPersistedProviderSelectionTarget(
    {
      activeProviderTarget: 'codex',
      providerTargetSelections: {
        codex: {
          model: 'gpt-5.4',
          effortLevel: 'xhigh',
        },
      },
    },
    { force: true },
  )

  expect(target?.targetKey).toBe('codex')
  expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(process.env.OPENAI_MODEL).toBe('gpt-5.4')
})

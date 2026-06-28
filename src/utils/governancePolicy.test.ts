import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  getAllowedSettingSources,
  setAllowedSettingSources,
} from '../bootstrap/state.js'
import {
  SETTING_SOURCES,
  type SettingSource,
} from './settings/constants.js'
import { resetSettingsCache } from './settings/settingsCache.js'
import type { SettingsJson } from './settings/types.js'
type GovernancePolicyModule = typeof import('./governancePolicy.js')

let originalAllowedSettingSources: ReturnType<typeof getAllowedSettingSources>
let settingsBySource = new Map<SettingSource, SettingsJson>()
let governancePolicy: GovernancePolicyModule

function setSourceSettings(
  source: SettingSource,
  settings: SettingsJson,
): void {
  settingsBySource.set(source, settings)
}

beforeEach(async () => {
  originalAllowedSettingSources = [...getAllowedSettingSources()]
  settingsBySource = new Map()
  setAllowedSettingSources([...SETTING_SOURCES])
  governancePolicy = (await import(
    `./governancePolicy.ts?governancePolicyTest=${Date.now()}-${Math.random()}`
  )) as GovernancePolicyModule
  governancePolicy.setGovernancePolicySettingsForSourceForTesting(
    source => settingsBySource.get(source) ?? null,
  )
  resetSettingsCache()
})

afterEach(() => {
  governancePolicy.setGovernancePolicySettingsForSourceForTesting(null)
  setAllowedSettingSources(originalAllowedSettingSources)
  settingsBySource = new Map()
  resetSettingsCache()
})

test('memory approval is required when any settings source opts in', () => {
  setSourceSettings('projectSettings', {
    memory: { requireApprovalBeforeWrite: true },
  })

  expect(governancePolicy.isMemoryWriteApprovalRequired()).toBe(true)
})

test('memory approval is required by default', () => {
  expect(governancePolicy.isMemoryWriteApprovalRequired()).toBe(true)
})

test('memory approval can be explicitly disabled when no source requires it', () => {
  setAllowedSettingSources(['projectSettings', 'localSettings'])
  setSourceSettings('projectSettings', {
    memory: { requireApprovalBeforeWrite: false },
  })

  expect(governancePolicy.isMemoryWriteApprovalRequired()).toBe(false)
})

test('generated attribution block settings are evaluated independently', () => {
  setSourceSettings('projectSettings', {
    git: { addAICoAuthor: false },
  })

  expect(governancePolicy.isGeneratedCommitAttributionBlocked()).toBe(true)
  expect(governancePolicy.isGeneratedPrAttributionBlocked()).toBe(false)
})

test('forbidden commit message patterns are combined across settings sources', () => {
  setSourceSettings('projectSettings', {
    git: { forbiddenCommitMessagePatterns: ['Generated with'] },
  })
  setSourceSettings('localSettings', {
    git: { forbiddenCommitMessagePatterns: ['Co-Authored-By:'] },
  })

  expect(
    governancePolicy.findForbiddenCommitMessagePattern(
      'fix: policy\n\nco-authored-by: OpenClaude <x@y.z>',
    ),
  ).toBe('Co-Authored-By:')
})

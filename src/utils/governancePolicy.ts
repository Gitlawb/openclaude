import { createHook, executionAsyncId } from 'async_hooks'
import { getEnabledSettingSources } from './settings/constants.js'
import { getInitialSettings, getSettingsForSource } from './settings/settings.js'
import type { SettingSource } from './settings/constants.js'
import type { SettingsJson } from './settings/types.js'

/**
 * Per-async-context governance overrides for testing. Each test file sets its
 * own override in beforeEach; the hook propagates it to descendant async
 * resources (including the it() callback), so parallel test execution cannot
 * corrupt the mock across files.
 */
const governanceOverrideByAsyncId = new Map<
  number,
  ((source: SettingSource) => SettingsJson | null) | null
>()

const governanceHook = createHook({
  init(asyncId, _type, triggerAsyncId) {
    const parentOverride = governanceOverrideByAsyncId.get(triggerAsyncId)
    if (parentOverride !== undefined) {
      governanceOverrideByAsyncId.set(asyncId, parentOverride)
    }
  },
  destroy(asyncId) {
    governanceOverrideByAsyncId.delete(asyncId)
  },
})

governanceHook.enable()

export function setGovernancePolicySettingsForSourceForTesting(
  getter: ((source: SettingSource) => SettingsJson | null) | null,
): void {
  governanceOverrideByAsyncId.set(executionAsyncId(), getter)
}

function getGovernanceSettingsForSource(
  source: SettingSource,
): SettingsJson | null {
  const override = governanceOverrideByAsyncId.get(executionAsyncId())
  if (override) {
    return override(source)
  }
  return getSettingsForSource(source)
}

export function isMemoryWriteApprovalRequired(): boolean {
  let explicitlyDisabled = false
  for (const source of getEnabledSettingSources()) {
    const value =
      getGovernanceSettingsForSource(source)?.memory?.requireApprovalBeforeWrite
    if (value === true) {
      return true
    }
    if (value === false) {
      explicitlyDisabled = true
    }
  }
  return !explicitlyDisabled
}

export function isGitAttributionBlocked(): boolean {
  return (
    isGeneratedCommitAttributionBlocked() || isGeneratedPrAttributionBlocked()
  )
}

export function isGeneratedCommitAttributionBlocked(): boolean {
  for (const source of getEnabledSettingSources()) {
    const git = getGovernanceSettingsForSource(source)?.git
    if (git?.addAICoAuthor === false) {
      return true
    }
  }
  return false
}

export function isGeneratedPrAttributionBlocked(): boolean {
  for (const source of getEnabledSettingSources()) {
    const git = getGovernanceSettingsForSource(source)?.git
    if (git?.addGeneratedWithFooter === false) {
      return true
    }
  }
  return false
}

export function getGitAttributionOptIns(): {
  addAICoAuthor: boolean
  addGeneratedWithFooter: boolean
} {
  const git = getInitialSettings().git
  return {
    addAICoAuthor: git?.addAICoAuthor === true,
    addGeneratedWithFooter: git?.addGeneratedWithFooter === true,
  }
}

export function getForbiddenCommitMessagePatterns(): string[] {
  const patterns: string[] = []
  for (const source of getEnabledSettingSources()) {
    const sourcePatterns =
      getGovernanceSettingsForSource(source)?.git
        ?.forbiddenCommitMessagePatterns ?? []
    for (const pattern of sourcePatterns) {
      if (!patterns.includes(pattern)) {
        patterns.push(pattern)
      }
    }
  }
  return patterns
}

export function findForbiddenCommitMessagePattern(
  message: string,
): string | null {
  const normalizedMessage = message.toLocaleLowerCase()
  for (const pattern of getForbiddenCommitMessagePatterns()) {
    if (!pattern) continue
    if (normalizedMessage.includes(pattern.toLocaleLowerCase())) {
      return pattern
    }
  }
  return null
}

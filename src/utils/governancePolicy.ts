import { getEnabledSettingSources } from './settings/constants.js'
import { getInitialSettings, getSettingsForSource } from './settings/settings.js'
import type { SettingSource } from './settings/constants.js'
import type { SettingsJson } from './settings/types.js'

let getSettingsForSourceForTesting:
  | ((source: SettingSource) => SettingsJson | null)
  | null = null

export function setGovernancePolicySettingsForSourceForTesting(
  getter: ((source: SettingSource) => SettingsJson | null) | null,
): void {
  getSettingsForSourceForTesting = getter
}

function getGovernanceSettingsForSource(
  source: SettingSource,
): SettingsJson | null {
  if (getSettingsForSourceForTesting) {
    return getSettingsForSourceForTesting(source)
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

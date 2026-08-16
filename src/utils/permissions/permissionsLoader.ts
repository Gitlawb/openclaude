import { logError } from '../log.js'
import {
  type EditableSettingSource,
  getEnabledSettingSources,
  type SettingSource,
} from '../settings/constants.js'
import {
  SETTINGS_UPDATE_NO_CHANGE,
  getSettingsForSource,
  updateSettingsForSourceWithFreshSettingsOrNoop,
  wasSettingsUpdateApplied,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
} from './PermissionRule.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'

/**
 * Returns true if allowManagedPermissionRulesOnly is enabled in managed settings (policySettings).
 * When enabled, only permission rules from managed settings are respected.
 */
export function shouldAllowManagedPermissionRulesOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.allowManagedPermissionRulesOnly ===
    true
  )
}

/**
 * Returns true if "always allow" options should be shown in permission prompts.
 * When allowManagedPermissionRulesOnly is enabled, these options are hidden.
 */
export function shouldShowAlwaysAllowOptions(): boolean {
  return !shouldAllowManagedPermissionRulesOnly()
}

const SUPPORTED_RULE_BEHAVIORS = [
  'allow',
  'deny',
  'ask',
] as const satisfies PermissionBehavior[]

/**
 * Converts permissions JSON to an array of PermissionRule objects
 * @param data The parsed permissions data
 * @param source The source of these rules
 * @returns Array of PermissionRule objects
 */
function settingsJsonToRules(
  data: SettingsJson | null,
  source: PermissionRuleSource,
): PermissionRule[] {
  if (!data || !data.permissions) {
    return []
  }

  const { permissions } = data
  const rules: PermissionRule[] = []
  for (const behavior of SUPPORTED_RULE_BEHAVIORS) {
    const behaviorArray = permissions[behavior]
    if (behaviorArray) {
      for (const ruleString of behaviorArray) {
        rules.push({
          source,
          ruleBehavior: behavior,
          ruleValue: permissionRuleValueFromString(ruleString),
        })
      }
    }
  }
  return rules
}

/**
 * Loads all permission rules from all relevant sources (managed and project settings)
 * @returns Array of all permission rules
 */
export function loadAllPermissionRulesFromDisk(): PermissionRule[] {
  // If allowManagedPermissionRulesOnly is set, only use managed permission rules
  if (shouldAllowManagedPermissionRulesOnly()) {
    return getPermissionRulesForSource('policySettings')
  }

  // Otherwise, load from all enabled sources (backwards compatible)
  const rules: PermissionRule[] = []

  for (const source of getEnabledSettingSources()) {
    rules.push(...getPermissionRulesForSource(source))
  }
  return rules
}

/**
 * Loads permission rules from a specific source
 * @param source The source to load from
 * @returns Array of permission rules from that source
 */
export function getPermissionRulesForSource(
  source: SettingSource,
): PermissionRule[] {
  const settingsData = getSettingsForSource(source)
  return settingsJsonToRules(settingsData, source)
}

export type PermissionRuleFromEditableSettings = PermissionRule & {
  source: EditableSettingSource
}

type AddPermissionRulesDependencies = {
  shouldAllowManagedRulesOnly?: typeof shouldAllowManagedPermissionRulesOnly
  updateFreshSettingsOrNoop?:
    typeof updateSettingsForSourceWithFreshSettingsOrNoop
}

// Editable sources that can be modified (excludes policySettings and flagSettings)
const EDITABLE_SOURCES: EditableSettingSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
]

/**
 * Deletes a rule from the project permissions file
 * @param rule The rule to delete
 * @returns Promise resolving to a boolean indicating success
 */
export function deletePermissionRuleFromSettings(
  rule: PermissionRuleFromEditableSettings,
): boolean {
  // Runtime check to ensure source is actually editable
  if (!EDITABLE_SOURCES.includes(rule.source as EditableSettingSource)) {
    return false
  }

  const ruleString = permissionRuleValueToString(rule.ruleValue)
  const settingsData = getSettingsForSource(rule.source)

  // If there's no settings data or permissions, nothing to do
  if (!settingsData || !settingsData.permissions) {
    return false
  }

  const behaviorArray = settingsData.permissions[rule.ruleBehavior]
  if (!behaviorArray) {
    return false
  }

  // Normalize raw settings entries via roundtrip parse→serialize so legacy
  // names (e.g. "KillShell") match their canonical form ("TaskStop").
  const normalizeEntry = (raw: string): string =>
    permissionRuleValueToString(permissionRuleValueFromString(raw))

  if (!behaviorArray.some(raw => normalizeEntry(raw) === ruleString)) {
    return false
  }

  try {
    let removed = false
    const result = updateSettingsForSourceWithFreshSettingsOrNoop(
      rule.source,
      freshSettings => {
        const freshRules = freshSettings.permissions?.[rule.ruleBehavior] ?? []
        const filteredRules = freshRules.filter(
          raw => normalizeEntry(raw) !== ruleString,
        )
        removed = filteredRules.length !== freshRules.length
        if (!removed) return SETTINGS_UPDATE_NO_CHANGE
        return {
          permissions: {
            [rule.ruleBehavior]: filteredRules,
          },
        }
      },
    )
    if (!wasSettingsUpdateApplied(result)) {
      // Error already logged inside updateSettingsForSource
      return false
    }

    return removed
  } catch (error) {
    logError(error)
    return false
  }
}

/**
 * Adds rules to the project permissions file
 * @param ruleValues The rule values to add
 * @returns Promise resolving to a boolean indicating success
 */
export function addPermissionRulesToSettings(
  {
    ruleValues,
    ruleBehavior,
  }: {
    ruleValues: PermissionRuleValue[]
    ruleBehavior: PermissionBehavior
  },
  source: EditableSettingSource,
  dependencies?: AddPermissionRulesDependencies,
): boolean {
  // When allowManagedPermissionRulesOnly is enabled, don't persist new permission rules
  const managedRulesOnly =
    dependencies?.shouldAllowManagedRulesOnly ??
    shouldAllowManagedPermissionRulesOnly
  if (managedRulesOnly()) {
    return false
  }

  if (ruleValues.length < 1) {
    // No rules to add
    return true
  }

  const ruleStrings = ruleValues.map(permissionRuleValueToString)
  try {
    const updateFreshSettingsOrNoop =
      dependencies?.updateFreshSettingsOrNoop ??
      updateSettingsForSourceWithFreshSettingsOrNoop
    const result = updateFreshSettingsOrNoop(
      source,
      freshSettings => {
        const existingRules = freshSettings.permissions?.[ruleBehavior] ?? []
        const existingRulesSet = new Set(
          existingRules.map(raw =>
            permissionRuleValueToString(permissionRuleValueFromString(raw)),
          ),
        )
        const newRules = ruleStrings.filter(
          rule => !existingRulesSet.has(rule),
        )
        if (newRules.length === 0) {
          return SETTINGS_UPDATE_NO_CHANGE
        }
        return {
          permissions: {
            [ruleBehavior]: [...existingRules, ...newRules],
          },
        }
      },
    )

    if (!wasSettingsUpdateApplied(result)) {
      throw result.error ?? new Error('Settings update was not written')
    }

    return true
  } catch (error) {
    logError(error)
    return false
  }
}

import { posix } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
// Types extracted to src/types/permissions.ts to break import cycles
import type {
  AdditionalWorkingDirectory,
  WorkingDirectorySource,
} from '../../types/permissions.js'
import { logForDebugging } from '../debug.js'
import type { EditableSettingSource } from '../settings/constants.js'
import {
  updateSettingsForSourceWithResult,
  updateSettingsForSourceWithFreshSettings,
  wasSettingsUpdateCommitted,
} from '../settings/settings.js'
import { jsonStringify } from '../slowOperations.js'
import { toPosixPath } from './filesystem.js'
import type { PermissionRuleValue } from './PermissionRule.js'
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from './PermissionUpdateSchema.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'
import { addPermissionRulesToSettings } from './permissionsLoader.js'

// Re-export for backwards compatibility
export type { AdditionalWorkingDirectory, WorkingDirectorySource }

function normalizeRuleString(rule: string): string {
  return permissionRuleValueToString(permissionRuleValueFromString(rule))
}

export function extractRules(
  updates: PermissionUpdate[] | undefined,
): PermissionRuleValue[] {
  if (!updates) return []

  return updates.flatMap(update => {
    switch (update.type) {
      case 'addRules':
        return update.rules
      default:
        return []
    }
  })
}

export function hasRules(updates: PermissionUpdate[] | undefined): boolean {
  return extractRules(updates).length > 0
}

/**
 * PermissionRequest hooks may approve the current read-only action in plan
 * mode, but they must not persist updates that change later permission checks
 * or leave plan mode programmatically.
 */
export function filterPermissionRequestHookUpdates(
  updates: PermissionUpdate[],
  enforcePlanMode: boolean,
): PermissionUpdate[] {
  return enforcePlanMode ? [] : updates
}

/**
 * Applies a single permission update to the context and returns the updated context
 * @param context The current permission context
 * @param update The permission update to apply
 * @returns The updated permission context
 */
export function applyPermissionUpdate(
  context: ToolPermissionContext,
  update: PermissionUpdate,
): ToolPermissionContext {
  switch (update.type) {
    case 'setMode':
      logForDebugging(
        `Applying permission update: Setting mode to '${update.mode}'`,
      )
      return {
        ...context,
        mode: update.mode,
      }

    case 'addRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Adding ${update.rules.length} ${update.behavior} rule(s) to destination '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: [
            ...(context[ruleKind][update.destination] || []),
            ...ruleStrings,
          ],
        },
      }
    }

    case 'replaceRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Replacing all ${update.behavior} rules for destination '${update.destination}' with ${update.rules.length} rule(s): ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: ruleStrings, // Replace all rules for this source
        },
      }
    }

    case 'addDirectories': {
      logForDebugging(
        `Applying permission update: Adding ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} with destination '${update.destination}': ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.set(directory, {
          path: directory,
          source: update.destination,
        })
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    case 'removeRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Removing ${update.rules.length} ${update.behavior} rule(s) from source '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      // Filter out the rules to be removed
      const existingRules = context[ruleKind][update.destination] || []
      const rulesToRemove = new Set(ruleStrings)
      const filteredRules = existingRules.filter(
        rule => !rulesToRemove.has(normalizeRuleString(rule)),
      )

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: filteredRules,
        },
      }
    }

    case 'removeDirectories': {
      logForDebugging(
        `Applying permission update: Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'}: ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.delete(directory)
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    default:
      return context
  }
}

/**
 * Applies multiple permission updates to the context and returns the updated context
 * @param context The current permission context
 * @param updates The permission updates to apply
 * @returns The updated permission context
 */
export function applyPermissionUpdates(
  context: ToolPermissionContext,
  updates: PermissionUpdate[],
): ToolPermissionContext {
  let updatedContext = context
  for (const update of updates) {
    updatedContext = applyPermissionUpdate(updatedContext, update)
  }

  return updatedContext
}

export function supportsPersistence(
  destination: PermissionUpdateDestination,
): destination is EditableSettingSource {
  return (
    destination === 'localSettings' ||
    destination === 'userSettings' ||
    destination === 'projectSettings'
  )
}

/**
 * Persists a permission update to the appropriate settings source
 * @param update The permission update to persist
 * @returns Whether no write was required or the requested update reached disk
 */
export function persistPermissionUpdate(update: PermissionUpdate): boolean {
  if (!supportsPersistence(update.destination)) return true

  logForDebugging(
    `Persisting permission update: ${update.type} to source '${update.destination}'`,
  )

  switch (update.type) {
    case 'addRules': {
      logForDebugging(
        `Persisting ${update.rules.length} ${update.behavior} rule(s) to ${update.destination}`,
      )
      return addPermissionRulesToSettings(
        {
          ruleValues: update.rules,
          ruleBehavior: update.behavior,
        },
        update.destination,
      )
    }

    case 'addDirectories': {
      logForDebugging(
        `Persisting ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} to ${update.destination}`,
      )
      return wasSettingsUpdateCommitted(
        updateSettingsForSourceWithFreshSettings(
          update.destination,
          freshSettings => {
            const existingDirs =
              freshSettings.permissions?.additionalDirectories ?? []
            const updatedDirs = [
              ...new Set([...existingDirs, ...update.directories]),
            ]
            return {
              permissions: {
                additionalDirectories: updatedDirs,
              },
            }
          },
        ),
      )
    }

    case 'removeRules': {
      logForDebugging(
        `Removing ${update.rules.length} ${update.behavior} rule(s) from ${update.destination}`,
      )
      const rulesToRemove = new Set(
        update.rules.map(permissionRuleValueToString),
      )
      return wasSettingsUpdateCommitted(
        updateSettingsForSourceWithFreshSettings(
          update.destination,
          freshSettings => ({
            permissions: {
              [update.behavior]: (
                freshSettings.permissions?.[update.behavior] ?? []
              ).filter(rule => !rulesToRemove.has(normalizeRuleString(rule))),
            },
          }),
        ),
      )
    }

    case 'removeDirectories': {
      logForDebugging(
        `Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} from ${update.destination}`,
      )
      const dirsToRemove = new Set(update.directories)
      return wasSettingsUpdateCommitted(
        updateSettingsForSourceWithFreshSettings(
          update.destination,
          freshSettings => ({
            permissions: {
              additionalDirectories: (
                freshSettings.permissions?.additionalDirectories ?? []
              ).filter(dir => !dirsToRemove.has(dir)),
            },
          }),
        ),
      )
    }

    case 'setMode': {
      logForDebugging(
        `Persisting mode '${update.mode}' to ${update.destination}`,
      )
      return wasSettingsUpdateCommitted(
        updateSettingsForSourceWithResult(update.destination, {
          permissions: {
            defaultMode: update.mode,
          },
        }),
      )
    }

    case 'replaceRules': {
      logForDebugging(
        `Replacing all ${update.behavior} rules in ${update.destination} with ${update.rules.length} rule(s)`,
      )
      const ruleStrings = update.rules.map(permissionRuleValueToString)
      return wasSettingsUpdateCommitted(
        updateSettingsForSourceWithResult(update.destination, {
          permissions: {
            [update.behavior]: ruleStrings,
          },
        }),
      )
    }
  }
}

/**
 * Persists multiple permission updates to the appropriate settings sources
 * Only persists updates with persistable sources
 * @param updates The permission updates to persist
 * @returns The updates whose requested state was applied and those that failed
 */
export function persistPermissionUpdates(updates: PermissionUpdate[]): {
  appliedUpdates: PermissionUpdate[]
  failedUpdates: PermissionUpdate[]
  allApplied: boolean
} {
  const appliedUpdates: PermissionUpdate[] = []
  const failedUpdates: PermissionUpdate[] = []
  for (const update of updates) {
    if (persistPermissionUpdate(update)) {
      appliedUpdates.push(update)
    } else {
      failedUpdates.push(update)
    }
  }
  return {
    appliedUpdates,
    failedUpdates,
    allApplied: failedUpdates.length === 0,
  }
}

/** User-visible explanation for a durable permission update that did not land. */
export function permissionPersistenceFailureMessage(
  failedUpdates: PermissionUpdate[],
): string {
  const destinations = [
    ...new Set(failedUpdates.map(update => update.destination)),
  ].sort()
  return `Permission changes could not be saved to ${destinations.join(', ')}; the requested action was not allowed.`
}

/**
 * Creates a Read rule suggestion for a directory.
 * @param dirPath The directory path to create a rule for
 * @param destination The destination for the permission rule (defaults to 'session')
 * @returns A PermissionUpdate for a Read rule, or undefined for the root directory
 */
export function createReadRuleSuggestion(
  dirPath: string,
  destination: PermissionUpdateDestination = 'session',
): PermissionUpdate | undefined {
  // Convert to POSIX format for pattern matching (handles Windows internally)
  const pathForPattern = toPosixPath(dirPath)

  // Root directory is too broad to be a reasonable permission target
  if (pathForPattern === '/') {
    return undefined
  }

  // For absolute paths, prepend an extra / to create //path/** pattern
  const ruleContent = posix.isAbsolute(pathForPattern)
    ? `/${pathForPattern}/**`
    : `${pathForPattern}/**`

  return {
    type: 'addRules',
    rules: [
      {
        toolName: 'Read',
        ruleContent,
      },
    ],
    behavior: 'allow',
    destination,
  }
}

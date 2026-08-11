import { logEvent } from 'src/services/analytics/index.js'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  updateSettingsForSourceWithFreshSettings,
  wasSettingsUpdateCommitted,
} from '../utils/settings/settings.js'

/**
 * Migration: Move MCP server approval fields from project config to local settings
 * This migrates both enableAllProjectMcpServers and enabledMcpjsonServers to the
 * settings system for better management and consistency.
 */
export function migrateEnableAllProjectMcpServersToSettings(): void {
  const projectConfig = getCurrentProjectConfig()

  // Check if any field exists in project config
  const hasEnableAll = projectConfig.enableAllProjectMcpServers !== undefined
  const hasEnabledServers =
    projectConfig.enabledMcpjsonServers &&
    projectConfig.enabledMcpjsonServers.length > 0
  const hasDisabledServers =
    projectConfig.disabledMcpjsonServers &&
    projectConfig.disabledMcpjsonServers.length > 0

  if (!hasEnableAll && !hasEnabledServers && !hasDisabledServers) {
    return
  }

  try {
    const fieldsToRemove: Array<
      | 'enableAllProjectMcpServers'
      | 'enabledMcpjsonServers'
      | 'disabledMcpjsonServers'
    > = []

    if (hasEnableAll) fieldsToRemove.push('enableAllProjectMcpServers')
    if (hasEnabledServers) fieldsToRemove.push('enabledMcpjsonServers')
    if (hasDisabledServers) fieldsToRemove.push('disabledMcpjsonServers')

    const result = updateSettingsForSourceWithFreshSettings(
      'localSettings',
      freshSettings => ({
        ...(hasEnableAll &&
        freshSettings.enableAllProjectMcpServers === undefined
          ? {
              enableAllProjectMcpServers:
                projectConfig.enableAllProjectMcpServers,
            }
          : {}),
        ...(hasEnabledServers && projectConfig.enabledMcpjsonServers
          ? {
              enabledMcpjsonServers: [
                ...new Set([
                  ...(freshSettings.enabledMcpjsonServers ?? []),
                  ...projectConfig.enabledMcpjsonServers,
                ]),
              ],
            }
          : {}),
        ...(hasDisabledServers && projectConfig.disabledMcpjsonServers
          ? {
              disabledMcpjsonServers: [
                ...new Set([
                  ...(freshSettings.disabledMcpjsonServers ?? []),
                  ...projectConfig.disabledMcpjsonServers,
                ]),
              ],
            }
          : {}),
      }),
    )
    if (!wasSettingsUpdateCommitted(result)) {
      if (result.error) logError(result.error)
      logEvent('tengu_migrate_mcp_approval_fields_error', {})
      return
    }

    // Remove migrated fields from project config
    if (
      fieldsToRemove.includes('enableAllProjectMcpServers') ||
      fieldsToRemove.includes('enabledMcpjsonServers') ||
      fieldsToRemove.includes('disabledMcpjsonServers')
    ) {
      saveCurrentProjectConfig(current => {
        const {
          enableAllProjectMcpServers: _enableAll,
          enabledMcpjsonServers: _enabledServers,
          disabledMcpjsonServers: _disabledServers,
          ...configWithoutFields
        } = current
        return configWithoutFields
      })
    }

    // Log the migration event
    logEvent('tengu_migrate_mcp_approval_fields_success', {
      migratedCount: fieldsToRemove.length,
    })
  } catch (e: unknown) {
    // Log migration failure but don't throw to avoid breaking startup
    logError(e)
    logEvent('tengu_migrate_mcp_approval_fields_error', {})
  }
}

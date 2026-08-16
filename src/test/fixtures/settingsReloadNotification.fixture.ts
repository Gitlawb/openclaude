import { mock } from 'bun:test'
import { handleReloadSettingsDownloadResult } from '../../services/settingsSync/downloadLifecycle.js'

const notified: string[] = []
let refreshed = 0
const scenario = process.argv[2] ?? 'partial'

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'DOWNLOAD_USER_SETTINGS',
}))
mock.module('../../bootstrap/state.js', () => ({ getIsRemoteMode: () => true }))
mock.module('../../services/settingsSync/index.js', () => ({
  handleReloadSettingsDownloadResult,
  redownloadUserSettings: async () =>
    scenario === 'fetch-failed'
      ? {
          complete: false,
          failureKind: 'fetch_failed',
          settingsSourcesWritten: [],
        }
      : scenario === 'prepare-failed'
        ? {
            complete: false,
            failureKind: 'prepare_failed',
            settingsSourcesWritten: [],
          }
        : {
          complete: false,
          failureKind: 'apply_failed',
          settingsSourcesWritten: ['userSettings', 'localSettings'],
          },
}))
mock.module('../../utils/plugins/refresh.js', () => ({
  refreshActivePlugins: async () => {
    refreshed++
    return {
      agentDefinitions: { allAgents: [] },
      agent_count: 0,
      command_count: 0,
      enabled_count: 0,
      error_count: 0,
      hook_count: 0,
      lsp_count: 0,
      mcp_count: 0,
    }
  },
}))
mock.module('../../utils/settings/changeDetector.js', () => ({
  settingsChangeDetector: {
    notifyChange(source: string) {
      notified.push(source)
    },
  },
}))

const { call } = await import('../../commands/reload-plugins/reload-plugins.js')
const result = await call('', { setAppState() {} } as never)

process.stdout.write(JSON.stringify({ notified, refreshed, result }))

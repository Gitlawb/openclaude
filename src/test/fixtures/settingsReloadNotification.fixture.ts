import { mock } from 'bun:test'

const notified: string[] = []

mock.module('bun:bundle', () => ({ feature: () => true }))
mock.module('../../bootstrap/state.js', () => ({ getIsRemoteMode: () => true }))
mock.module('../../services/settingsSync/index.js', () => ({
  redownloadUserSettings: async () => ({
    complete: false,
    settingsWritten: true,
    settingsSourcesWritten: ['userSettings', 'localSettings'],
  }),
}))
mock.module('../../utils/plugins/refresh.js', () => ({
  refreshActivePlugins: async () => ({
    agentDefinitions: { allAgents: [] },
    agent_count: 0,
    command_count: 0,
    enabled_count: 0,
    error_count: 0,
    hook_count: 0,
    lsp_count: 0,
    mcp_count: 0,
  }),
}))
mock.module('../../utils/settings/changeDetector.js', () => ({
  settingsChangeDetector: {
    notifyChange(source: string) {
      notified.push(source)
    },
  },
}))

const { call } = await import('../../commands/reload-plugins/reload-plugins.js')
await call('', { setAppState() {} } as never)

process.stdout.write(JSON.stringify({ notified }))

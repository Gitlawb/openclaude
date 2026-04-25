import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'lmstudio',
  label: 'LM Studio',
  category: 'local',
  defaultBaseUrl: 'http://localhost:1234/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'none',
  },
  transportConfig: {
    kind: 'local',
    openaiShim: {
      supportsUserCustomHeaders: true,
    },
  },
  catalog: {
    source: 'dynamic',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
  },
  usage: { supported: false },
})

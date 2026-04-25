import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'atomic-chat',
  label: 'Atomic Chat',
  category: 'local',
  defaultBaseUrl: 'http://127.0.0.1:1337/v1',
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

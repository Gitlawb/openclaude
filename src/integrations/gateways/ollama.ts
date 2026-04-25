import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'ollama',
  label: 'Ollama',
  category: 'local',
  defaultBaseUrl: 'http://localhost:11434/v1',
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
    discovery: { kind: 'ollama' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
  },
  usage: { supported: false },
})

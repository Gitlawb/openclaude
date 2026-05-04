import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'atomic-chat',
  label: 'Atomic Chat',
  category: 'local',
  defaultBaseUrl: 'http://127.0.0.1:1337/v1',
  defaultModel: 'local-model',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'none',
  },
  startup: {
    autoDetectable: true,
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'local',
    openaiShim: {
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
    },
  },
  preset: {
    id: 'atomic-chat',
    description: 'Local Model Provider',
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
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

import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'lmstudio',
  label: 'LM Studio',
  category: 'local',
  defaultBaseUrl: 'http://localhost:1234/v1',
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
    id: 'lmstudio',
    description: 'Local LM Studio endpoint',
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'dynamic',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'startup',
    allowManualRefresh: true,
  },
  usage: { supported: false },
})

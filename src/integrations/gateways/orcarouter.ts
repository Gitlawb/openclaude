import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'orcarouter',
  label: 'OrcaRouter',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.orcarouter.ai/v1',
  defaultModel: 'openai/gpt-5-mini',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ORCAROUTER_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'orcarouter',
    description: 'OrcaRouter OpenAI-compatible endpoint',
    apiKeyEnvVars: ['ORCAROUTER_API_KEY'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    // `GET https://api.orcarouter.ai/v1/models` is public; inference needs the key.
    discovery: { kind: 'openai-compatible', requiresAuth: false },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      { id: 'orcarouter-gpt-5-mini', apiName: 'openai/gpt-5-mini', label: 'GPT-5 Mini (via OrcaRouter)', modelDescriptorId: 'gpt-5-mini' },
    ],
  },
  usage: { supported: false },
})

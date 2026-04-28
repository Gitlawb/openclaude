import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'openrouter',
  label: 'OpenRouter',
  category: 'aggregating',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-5-mini',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENROUTER_API_KEY'],
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
    id: 'openrouter',
    description: 'OpenRouter OpenAI-compatible endpoint',
    apiKeyEnvVars: ['OPENROUTER_API_KEY'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      { id: 'openrouter-gpt-5-mini', apiName: 'openai/gpt-5-mini', label: 'GPT-5 Mini (via OpenRouter)', modelDescriptorId: 'gpt-5-mini' },
    ],
  },
  usage: { supported: false },
})

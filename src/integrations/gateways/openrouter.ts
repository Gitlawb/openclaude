import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'openrouter',
  label: 'OpenRouter',
  category: 'aggregating',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENROUTER_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsUserCustomHeaders: true,
    },
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      { id: 'openrouter-gpt-5-mini', apiName: 'openai/gpt-5-mini', label: 'GPT-5 Mini (via OpenRouter)', default: true },
    ],
  },
  usage: { supported: false },
})

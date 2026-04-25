import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'moonshot',
  label: 'Moonshot AI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.moonshot.ai/v1',
  defaultModel: 'kimi-k2.5',
  requiredEnvVars: ['MOONSHOT_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['MOONSHOT_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'kimi-k2.5', apiName: 'kimi-k2.5', label: 'Kimi K2.5', default: true },
      { id: 'kimi-k2.6', apiName: 'kimi-k2.6', label: 'Kimi K2.6' },
    ],
  },
  usage: { supported: false },
})

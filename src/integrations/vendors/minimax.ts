import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'minimax',
  label: 'MiniMax',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.minimax.io/v1',
  defaultModel: 'MiniMax-M2.5',
  requiredEnvVars: ['MINIMAX_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['MINIMAX_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'minimax-m2.5', apiName: 'MiniMax-M2.5', label: 'MiniMax M2.5', default: true },
    ],
  },
  usage: { supported: true },
})

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
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
    },
    credentialEnvVars: ['MINIMAX_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'MiniMax auth is required. Set MINIMAX_API_KEY or OPENAI_API_KEY.',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'minimax-m2.5', apiName: 'MiniMax-M2.5', label: 'MiniMax M2.5', default: true },
    ],
  },
  usage: { supported: true },
})

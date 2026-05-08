import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'minimax',
  label: 'MiniMax',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.minimax.io/v1',
  defaultModel: 'MiniMax-M2.7',
  requiredEnvVars: ['MINIMAX_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['MINIMAX_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'minimax',
    description: 'MiniMax API endpoint',
    apiKeyEnvVars: ['MINIMAX_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.minimax.io', 'api.minimax.chat'],
    },
    credentialEnvVars: ['MINIMAX_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'MiniMax auth is required. Set MINIMAX_API_KEY or OPENAI_API_KEY.',
  },
  usage: { supported: true },
})

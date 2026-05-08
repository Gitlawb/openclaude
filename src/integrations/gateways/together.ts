import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'together',
  label: 'Together AI',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['TOGETHER_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'together',
    description: 'Together chat/completions endpoint',
    apiKeyEnvVars: ['TOGETHER_API_KEY'],
    vendorId: 'openai',
  },
  usage: { supported: false },
})

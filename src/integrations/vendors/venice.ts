import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'venice',
  label: 'Venice',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.venice.ai/api/v1',
  defaultModel: 'venice-uncensored',
  requiredEnvVars: ['VENICE_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['VENICE_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'venice',
    description: 'Venice OpenAI-compatible endpoint',
    apiKeyEnvVars: ['VENICE_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.venice.ai'],
    },
    credentialEnvVars: ['VENICE_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Venice auth is required. Set VENICE_API_KEY or OPENAI_API_KEY.',
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'venice-uncensored',
        apiName: 'venice-uncensored',
        label: 'Venice Uncensored',
      },
    ],
  },
  usage: { supported: true },
})

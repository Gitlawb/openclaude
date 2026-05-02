import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'xai',
  label: 'xAI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.x.ai/v1',
  defaultModel: 'grok-4',
  requiredEnvVars: ['XAI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['XAI_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  preset: {
    id: 'xai',
    description: 'xAI Grok OpenAI-compatible endpoint',
    apiKeyEnvVars: ['XAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.x.ai'],
    },
    credentialEnvVars: ['XAI_API_KEY'],
    missingCredentialMessage:
      'XAI_API_KEY is required for the xAI provider.',
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'grok-4',
        apiName: 'grok-4',
        label: 'Grok 4',
        modelDescriptorId: 'grok-4',
      },
      {
        id: 'grok-3',
        apiName: 'grok-3',
        label: 'Grok 3',
        modelDescriptorId: 'grok-3',
      },
    ],
  },
  usage: { supported: false },
})

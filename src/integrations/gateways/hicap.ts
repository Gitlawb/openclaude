import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'hicap',
  label: 'Hicap',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.hicap.ai/v1',
  defaultModel: 'claude-opus-4.7',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['HICAP_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: true,
      supportsAuthHeaders: true,
      ui: {
        showAuthHeader: false,
        showAuthHeaderValue: false,
        showCustomHeaders: true,
      },
      defaultAuthHeader: {
        name: 'api-key',
        scheme: 'raw',
      },
      responsesApiModelPrefixes: ['gpt-'],
    },
  },
  preset: {
    id: 'hicap',
    description: 'Hicap OpenAI-compatible gateway',
    apiKeyEnvVars: ['HICAP_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.hicap.ai'],
    },
    credentialEnvVars: ['HICAP_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Set HICAP_API_KEY or OPENAI_API_KEY for the Hicap provider.',
  },
  usage: { supported: false },
})

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
      'HICAP_API_KEY is required for the Hicap provider.',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible', requiresAuth: false },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      {
        id: 'hicap-claude-opus-4.7',
        apiName: 'claude-opus-4.7',
        label: 'Claude Opus 4.7',
        modelDescriptorId: 'claude-opus-4-7',
      },
    ],
  },
  usage: { supported: false },
})

import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'llmtr',
  label: 'LLMTR',
  category: 'aggregating',
  defaultBaseUrl: 'https://llmtr.com/v1',
  defaultModel: 'llmtr/gemma-4',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['LLMTR_API_KEY'],
    // Dedicated key only: never fall back to OPENAI_API_KEY, which would send a
    // generic OpenAI credential to llmtr.com.
    dedicatedCredentialsOnly: true,
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'llmtr',
    description: 'LLMTR OpenAI-compatible gateway (Turkey-hosted)',
    apiKeyEnvVars: ['LLMTR_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['llmtr.com'],
    },
    credentialEnvVars: ['LLMTR_API_KEY'],
    missingCredentialMessage:
      'Set LLMTR_API_KEY for the LLMTR provider. Get a key at https://llmtr.com.',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      // Turkey-hosted models run on LLMTR infrastructure.
      { id: 'llmtr-gemma-4', apiName: 'llmtr/gemma-4', label: 'Gemma 4 (Turkey-hosted)', modelDescriptorId: 'llmtr/gemma-4' },
      { id: 'llmtr-trendyol-7b', apiName: 'llmtr/trendyol-7b', label: 'Trendyol 7B (Turkey-hosted)', modelDescriptorId: 'llmtr/trendyol-7b' },
      { id: 'llmtr-sincap', apiName: 'llmtr/sincap', label: 'Sincap (Turkey-hosted)', modelDescriptorId: 'llmtr/sincap' },
      { id: 'llmtr-magibu-11b-v8', apiName: 'llmtr/magibu-11b-v8', label: 'Magibu 11B v8 (Turkey-hosted)', modelDescriptorId: 'llmtr/magibu-11b-v8' },
    ],
  },
  usage: { supported: false },
})

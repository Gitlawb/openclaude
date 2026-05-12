import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'qiniu',
  label: 'Qiniu',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.qnaigc.com/v1',
  defaultModel: 'deepseek-v3',
  requiredEnvVars: ['QINIU_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['QINIU_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'qiniu',
    description: 'Qiniu OpenAI-compatible endpoint',
    apiKeyEnvVars: ['QINIU_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.qnaigc.com'],
    },
    credentialEnvVars: ['QINIU_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Qiniu auth is required. Set QINIU_API_KEY or OPENAI_API_KEY.',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      {
        id: 'deepseek-v3',
        apiName: 'deepseek-v3',
        label: 'DeepSeek V3',
        modelDescriptorId: 'deepseek-v3',
      },
    ],
  },
  usage: { supported: false },
})

import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'atomcode',
  label: 'AtomCode (GitCode)',
  category: 'hosted',
  defaultBaseUrl: 'https://api-ai.gitcode.com/v1',
  defaultModel: 'deepseek-v4-flash',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ATOMCODE_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: false,
      headers: {
        'User-Agent': 'atomcode/4.22.3',
        'x-atomcode-client': 'atomcode-air',
      },
    },
  },
  preset: {
    id: 'atomcode',
    description: 'AtomCode (GitCode) DeepSeek API endpoint',
    apiKeyEnvVars: ['ATOMCODE_API_KEY'],
    baseUrlEnvVars: ['ATOMCODE_BASE_URL'],
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'deepseek',
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchBaseUrlHosts: ['api-ai.gitcode.com'],
    },
    credentialEnvVars: ['ATOMCODE_API_KEY'],
    missingCredentialMessage:
      'Set ATOMCODE_API_KEY for the AtomCode (GitCode) provider.',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      {
        id: 'atomcode-deepseek-v4-flash',
        apiName: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        modelDescriptorId: 'deepseek-v4-flash',
      },
      {
        id: 'atomcode-deepseek-v4-pro',
        apiName: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        modelDescriptorId: 'deepseek-v4-pro',
      },
      {
        id: 'atomcode-deepseek-chat',
        apiName: 'deepseek-chat',
        label: 'DeepSeek Chat',
        modelDescriptorId: 'deepseek-chat',
      },
    ],
  },
  usage: { supported: false },
})

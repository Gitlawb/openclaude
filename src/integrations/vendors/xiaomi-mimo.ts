import { defineCatalog, defineVendor } from '../define.js'

const catalog = defineCatalog({
  source: 'static',
  models: [
    {
      id: 'mimo-v2.5-pro',
      apiName: 'mimo-v2.5-pro',
      label: 'MiMo V2.5 Pro',
      modelDescriptorId: 'mimo-v2.5-pro',
    },
    {
      id: 'mimo-v2-pro',
      apiName: 'mimo-v2-pro',
      label: 'MiMo V2 Pro',
      modelDescriptorId: 'mimo-v2-pro',
    },
    {
      id: 'mimo-v2.5',
      apiName: 'mimo-v2.5',
      label: 'MiMo V2.5',
      modelDescriptorId: 'mimo-v2.5',
    },
    {
      id: 'mimo-v2-omni',
      apiName: 'mimo-v2-omni',
      label: 'MiMo V2 Omni',
      modelDescriptorId: 'mimo-v2-omni',
    },
    {
      id: 'mimo-v2-flash',
      apiName: 'mimo-v2-flash',
      label: 'MiMo V2 Flash',
      modelDescriptorId: 'mimo-v2-flash',
    },
  ],
})

export default defineVendor({
  id: 'xiaomi-mimo',
  label: 'Xiaomi MiMo',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
  defaultModel: 'mimo-v2.5-pro',
  requiredEnvVars: ['MIMO_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['MIMO_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      defaultAuthHeader: {
        name: 'api-key',
        scheme: 'raw',
      },
      preserveReasoningContent: true,
      requireReasoningContentOnAssistantMessages: true,
      reasoningContentFallback: '',
      maxTokensField: 'max_completion_tokens',
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'xiaomi-mimo',
    description: 'Xiaomi MiMo OpenAI-compatible endpoint',
    label: 'Xiaomi MiMo',
    name: 'Xiaomi MiMo',
    apiKeyEnvVars: ['MIMO_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.xiaomimimo.com', 'api.mimo-v2.com'],
    },
    credentialEnvVars: ['MIMO_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Xiaomi MiMo auth is required. Set MIMO_API_KEY or OPENAI_API_KEY.',
  },
  catalog,
  usage: { supported: false },
})

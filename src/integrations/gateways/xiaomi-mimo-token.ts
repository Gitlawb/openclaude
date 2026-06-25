import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'xiaomi-mimo-token',
  label: 'Xiaomi MiMo (Token Plan)',
  category: 'hosted',
  defaultBaseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
  defaultModel: 'mimo-v2.5-pro',
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
      maxTokensField: 'max_completion_tokens',
      removeBodyFields: ['store', 'stream_options'],
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'xiaomi-mimo-token',
    vendorId: 'xiaomi-mimo',
    description: 'Xiaomi MiMo Token Plan subscription endpoint',
    label: 'Xiaomi MiMo (Token Plan)',
    name: 'Xiaomi MiMo (Token Plan)',
    apiKeyEnvVars: ['MIMO_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    badge: { text: 'Sponsor', color: 'success' },
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: [
        'token-plan-sgp.xiaomimimo.com',
        'token-plan-cn.xiaomimimo.com',
      ],
    },
    credentialEnvVars: ['MIMO_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Xiaomi MiMo Token Plan auth is required. Set MIMO_API_KEY or OPENAI_API_KEY.',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'mimo-v2.5-pro', apiName: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', modelDescriptorId: 'mimo-v2.5-pro', reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'], defaultLevel: 'medium', wireFormat: 'reasoning_effort' } },
      { id: 'mimo-v2.5', apiName: 'mimo-v2.5', label: 'MiMo V2.5', modelDescriptorId: 'mimo-v2.5', reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'], defaultLevel: 'medium', wireFormat: 'reasoning_effort' } },
    ],
  },
  usage: { supported: false },
})

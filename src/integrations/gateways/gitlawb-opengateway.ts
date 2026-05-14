import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'gitlawb-opengateway',
  label: 'Gitlawb Opengateway',
  category: 'aggregating',
  defaultBaseUrl: 'https://opengateway.gitlawb.com/v1/xiaomi-mimo',
  defaultModel: 'mimo-v2.5-pro',
  supportsModelRouting: true,
  vendorId: 'xiaomi-mimo',
  setup: {
    requiresAuth: false,
    authMode: 'none',
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
    id: 'gitlawb-opengateway',
    description: 'Gitlawb Opengateway — free hosted MiMo (Xiaomi partnership)',
    label: 'Gitlawb Opengateway',
    name: 'Gitlawb Opengateway',
    vendorId: 'xiaomi-mimo',
    modelEnvVars: ['OPENAI_MODEL'],
    baseUrlEnvVars: ['OPENGATEWAY_BASE_URL', 'OPENAI_BASE_URL'],
    fallbackBaseUrl: 'https://opengateway.gitlawb.com/v1/xiaomi-mimo',
    fallbackModel: 'mimo-v2.5-pro',
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'opengateway-mimo-v2.5-pro',
        apiName: 'mimo-v2.5-pro',
        label: 'MiMo V2.5 Pro (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5-pro',
      },
      {
        id: 'opengateway-mimo-v2-pro',
        apiName: 'mimo-v2-pro',
        label: 'MiMo V2 Pro (via Opengateway)',
        modelDescriptorId: 'mimo-v2-pro',
      },
      {
        id: 'opengateway-mimo-v2.5',
        apiName: 'mimo-v2.5',
        label: 'MiMo V2.5 (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5',
      },
      {
        id: 'opengateway-mimo-v2-omni',
        apiName: 'mimo-v2-omni',
        label: 'MiMo V2 Omni (via Opengateway)',
        modelDescriptorId: 'mimo-v2-omni',
      },
      {
        id: 'opengateway-mimo-v2-flash',
        apiName: 'mimo-v2-flash',
        label: 'MiMo V2 Flash (via Opengateway)',
        modelDescriptorId: 'mimo-v2-flash',
      },
    ],
  },
  usage: { supported: false },
})

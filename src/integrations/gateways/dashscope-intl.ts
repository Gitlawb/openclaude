import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'dashscope-intl',
  label: 'Alibaba Coding Plan',
  category: 'hosted',
  defaultBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
  defaultModel: 'qwen3.6-plus',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['DASHSCOPE_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'dashscope-intl',
    description: 'Alibaba DashScope International endpoint',
    apiKeyEnvVars: ['DASHSCOPE_API_KEY'],
    vendorId: 'openai',
  },
  usage: { supported: false },
})

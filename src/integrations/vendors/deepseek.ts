import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'deepseek',
  label: 'DeepSeek',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  defaultModel: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  requiredEnvVars: ['DEEPSEEK_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['DEEPSEEK_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      preserveReasoningContent: true,
      requireReasoningContentOnAssistantMessages: true,
      reasoningContentFallback: '',
    },
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'deepseek-chat', apiName: 'deepseek-chat', label: 'DeepSeek Chat', default: true },
      { id: 'deepseek-reasoner', apiName: 'deepseek-reasoner', label: 'DeepSeek Reasoner', recommended: true },
      { id: 'deepseek-v4-flash', apiName: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', apiName: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  usage: { supported: false },
})

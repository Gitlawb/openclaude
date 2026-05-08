import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'zai',
  label: 'Z.AI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'GLM-5.1',
  requiredEnvVars: ['OPENAI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENAI_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      preserveReasoningContent: true,
      requireReasoningContentOnAssistantMessages: true,
      reasoningContentFallback: '',
      thinkingRequestFormat: 'deepseek-compatible',
      maxTokensField: 'max_tokens',
      removeBodyFields: ['store'],
    },
  },
  preset: {
    id: 'zai',
    description: 'Z.AI GLM coding subscription endpoint',
    label: 'Z.AI - GLM Coding Plan',
    name: 'Z.AI - GLM Coding Plan',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.z.ai'],
    },
    credentialEnvVars: ['OPENAI_API_KEY'],
    missingCredentialMessage:
      'OPENAI_API_KEY is required for Z.AI GLM Coding Plan.',
  },
  usage: { supported: false },
})

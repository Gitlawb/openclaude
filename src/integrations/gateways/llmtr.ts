import { defineGateway } from '../define.js'
import catalog from './llmtr.models.js'

export default defineGateway({
  id: 'llmtr',
  label: 'LLMTR',
  category: 'aggregating',
  defaultBaseUrl: 'https://llmtr.com/v1',
  defaultModel: 'deepseek/deepseek-v4-flash',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENAI_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      requiredApiFormat: 'chat_completions',
      supportsAuthHeaders: false,
      maxTokensField: 'max_tokens',
    },
  },
  preset: {
    id: 'llmtr',
    description: 'LLMTR OpenAI-compatible multi-model gateway',
    vendorId: 'openai',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['llmtr.com'],
    },
    credentialEnvVars: ['OPENAI_API_KEYS', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'LLMTR auth is required. Set OPENAI_API_KEY to your LLMTR API key.',
  },
  catalog,
  usage: { supported: false },
})

import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'ollama-cloud',
  label: 'Ollama Cloud',
  category: 'cloud',
  defaultBaseUrl: 'https://ollama.com/v1',
  defaultModel: 'gpt-oss:120b',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OLLAMA_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
      removeBodyFields: ['store'],
    },
  },
  preset: {
    id: 'ollama-cloud',
    description: 'Remote models via ollama.com (requires API key)',
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  usage: { supported: false },
})

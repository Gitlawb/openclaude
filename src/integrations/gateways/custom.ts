import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'custom',
  label: 'Custom OpenAI-compatible',
  category: 'hosted',
  defaultModel: 'llama3.1:8b',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'api-key',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: true,
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'custom',
    description: 'Any OpenAI-compatible provider',
    label: 'Custom',
    name: 'Custom OpenAI-compatible',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    baseUrlEnvVars: ['OPENAI_BASE_URL', 'OPENAI_API_BASE'],
    modelEnvVars: ['OPENAI_MODEL'],
    fallbackBaseUrl: 'http://localhost:11434/v1',
    vendorId: 'openai',
  },
  catalog: {
    source: 'static',
    models: [],
  },
  usage: { supported: false },
})

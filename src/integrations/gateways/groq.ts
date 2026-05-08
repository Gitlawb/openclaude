import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'groq',
  label: 'Groq',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['GROQ_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
      removeBodyFields: ['store'],
    },
  },
  preset: {
    id: 'groq',
    description: 'Groq OpenAI-compatible endpoint',
    apiKeyEnvVars: ['GROQ_API_KEY'],
    vendorId: 'openai',
  },
  usage: { supported: false },
})

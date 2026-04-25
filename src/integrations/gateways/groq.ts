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
      supportsUserCustomHeaders: true,
    },
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'groq-llama-3.3-70b', apiName: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', default: true },
    ],
  },
  usage: { supported: false },
})

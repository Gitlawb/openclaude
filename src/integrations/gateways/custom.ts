import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'custom',
  label: 'Custom OpenAI-compatible',
  category: 'hosted',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'api-key',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsUserCustomHeaders: true,
    },
  },
  catalog: {
    source: 'static',
    models: [],
  },
  usage: { supported: false },
})

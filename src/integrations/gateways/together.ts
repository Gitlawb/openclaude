import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'together',
  label: 'Together AI',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['TOGETHER_API_KEY'],
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
      { id: 'together-qwen-3.5-9b', apiName: 'Qwen/Qwen3.5-9B', label: 'Qwen 3.5 9B', default: true },
    ],
  },
  usage: { supported: false },
})

import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'kimi-code',
  label: 'Moonshot AI - Kimi Code',
  category: 'hosted',
  defaultBaseUrl: 'https://api.kimi.com/coding/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['KIMI_API_KEY'],
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
      { id: 'kimi-for-coding', apiName: 'kimi-for-coding', label: 'Kimi for Coding', default: true },
    ],
  },
  usage: { supported: false },
})

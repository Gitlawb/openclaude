import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'bankr',
  label: 'Bankr',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://llm.bankr.bot/v1',
  defaultModel: 'claude-opus-4.6',
  requiredEnvVars: ['BNKR_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['BNKR_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'claude-opus-4.6', apiName: 'claude-opus-4.6', label: 'Claude Opus 4.6', default: true },
    ],
  },
  usage: { supported: false },
})

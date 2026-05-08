import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'bankr',
  label: 'Bankr',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://llm.bankr.bot/v1',
  requiredEnvVars: ['BNKR_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['BNKR_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  preset: {
    id: 'bankr',
    description: 'Bankr LLM Gateway (OpenAI-compatible)',
    apiKeyEnvVars: ['BNKR_API_KEY'],
    modelEnvVars: ['BANKR_MODEL', 'OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
    },
    credentialEnvVars: ['BNKR_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Bankr auth is required. Set BNKR_API_KEY or OPENAI_API_KEY.',
  },
  usage: { supported: false },
})

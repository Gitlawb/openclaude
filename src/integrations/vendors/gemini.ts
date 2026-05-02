import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'gemini',
  label: 'Google Gemini',
  classification: 'native',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  defaultModel: 'gemini-3-flash-preview',
  requiredEnvVars: ['GEMINI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['GEMINI_API_KEY'],
  },
  transportConfig: {
    kind: 'gemini-native',
    openaiShim: {
      removeBodyFields: ['store'],
    },
  },
  preset: {
    id: 'gemini',
    description: 'Gemini OpenAI-compatible endpoint',
    apiKeyEnvVars: ['GEMINI_API_KEY'],
  },
  validation: {
    kind: 'gemini-credential',
    routing: {
      enablementEnvVar: 'CLAUDE_CODE_USE_GEMINI',
    },
    missingCredentialMessage:
      'GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or Google ADC credentials are required when CLAUDE_CODE_USE_GEMINI=1.',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'gemini-3-flash-preview', apiName: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
      { id: 'gemini-2.5-pro', apiName: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  usage: { supported: false },
})

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
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'gemini-3-flash-preview', apiName: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', default: true },
      { id: 'gemini-2.5-pro', apiName: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  usage: { supported: false },
})

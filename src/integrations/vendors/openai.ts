import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'openai',
  label: 'OpenAI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-5.4',
  requiredEnvVars: ['OPENAI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENAI_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  isFirstParty: true,
  catalog: {
    source: 'static',
    models: [
      { id: 'gpt-5.4', apiName: 'gpt-5.4', label: 'GPT-5.4', default: true },
      { id: 'gpt-5-mini', apiName: 'gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'gpt-4o', apiName: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', apiName: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
  },
  usage: { supported: false },
})

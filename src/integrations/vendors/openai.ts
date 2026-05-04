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
    openaiShim: {
      supportsApiFormatSelection: true,
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'openai',
    description: 'OpenAI API with API key',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      fallbackWhenUseOpenAI: true,
    },
    credentialEnvVars: ['OPENAI_API_KEY'],
    allowLocalBaseUrlWithoutCredential: true,
    missingCredentialMessage:
      'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
    invalidCredentialValues: [
      {
        envVar: 'OPENAI_API_KEY',
        value: 'SUA_CHAVE',
        message:
          'Invalid OPENAI_API_KEY: placeholder value SUA_CHAVE detected. Set a real key or unset for local providers.',
      },
    ],
  },
  isFirstParty: true,
  catalog: {
    source: 'static',
    models: [
      { id: 'gpt-5.4', apiName: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5-mini', apiName: 'gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'gpt-4o', apiName: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', apiName: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
  },
  usage: { supported: false },
})

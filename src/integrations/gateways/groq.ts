import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'groq',
  label: 'Groq',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  defaultModel: 'llama-3.3-70b-versatile',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['GROQ_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
      removeBodyFields: ['store', 'reasoning_effort'],
    },
  },
  preset: {
    id: 'groq',
    description: 'Groq OpenAI-compatible endpoint',
    apiKeyEnvVars: ['GROQ_API_KEY'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      mapModel(raw: unknown) {
        const model = raw as { id?: string; active?: boolean; context_window?: number }
        if (!model.id || model.active === false) {
          return null
        }
        if (/(whisper|distil-whisper|llama-guard|prompt-guard|safeguard|playai|orpheus)/i.test(model.id)) {
          return null
        }
        return {
          id: model.id,
          apiName: model.id,
          label: model.id,
          ...(model.context_window ? { contextWindow: model.context_window } : {}),
        }
      },
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      { id: 'groq-llama-3.3-70b', apiName: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', modelDescriptorId: 'llama-3.3-70b-versatile' },
    ],
  },
  usage: { supported: false },
})

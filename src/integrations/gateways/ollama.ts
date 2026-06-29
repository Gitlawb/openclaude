import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'ollama',
  label: 'Ollama',
  category: 'local',
  defaultBaseUrl: 'http://localhost:11434/v1',
  defaultModel: 'llama3.1:8b',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'none',
  },
  startup: {
    autoDetectable: true,
    probeReadiness: 'ollama-generation',
  },
  transportConfig: {
    kind: 'local',
    openaiShim: {
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
    },
  },
  preset: {
    id: 'ollama',
    description: 'Local or remote Ollama endpoint',
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'ollama' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      {
        id: 'ollama-qwen3-coder-next-cloud',
        apiName: 'qwen3-coder-next:cloud',
        label: 'Qwen 3 Coder Next (Ollama Cloud)',
        modelDescriptorId: 'qwen3-coder-next',
        maxOutputTokens: 32_768,
        notes:
          'Ollama Cloud rejects requests above 32768 output tokens for this model.',
      },
      {
        id: 'deepseek-v4-pro-cloud',
        apiName: 'deepseek-v4-pro:cloud',
        label: 'DeepSeek V4 Pro (Cloud)',
        modelDescriptorId: 'deepseek-v4-pro',
        contextWindow: 1_048_576,
        maxOutputTokens: 65_536,
      },
    ],
  },
  usage: { supported: false },
})

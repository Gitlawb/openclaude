import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'nvidia-nim',
  label: 'NVIDIA NIM',
  category: 'hosted',
  defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['NVIDIA_API_KEY'],
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
      { id: 'nvidia-llama-3.1-nemotron-70b', apiName: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Llama 3.1 Nemotron 70B', default: true },
    ],
  },
  usage: { supported: false },
})

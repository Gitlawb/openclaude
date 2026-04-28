import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'nvidia-nim',
  label: 'NVIDIA NIM',
  category: 'hosted',
  defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
  defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['NVIDIA_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'nvidia-nim',
    description: 'NVIDIA NIM endpoint',
    apiKeyEnvVars: ['NVIDIA_API_KEY'],
    vendorId: 'openai',
  },
  validation: {
    kind: 'credential-env',
    credentialEnvVars: ['NVIDIA_API_KEY'],
    missingCredentialMessage:
      'NVIDIA_API_KEY is required when using NVIDIA NIM.',
    routing: {
      enablementEnvVar: 'NVIDIA_NIM',
      matchDefaultBaseUrl: true,
    },
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'nvidia-llama-3.1-nemotron-70b', apiName: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Llama 3.1 Nemotron 70B', modelDescriptorId: 'nvidia/llama-3.1-nemotron-70b-instruct' },
    ],
  },
  usage: { supported: false },
})

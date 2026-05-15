import { defineGateway } from '../define.js'

// Patterns for catalog entries returned by https://integrate.api.nvidia.com/v1/models
// that are NOT chat/instruct models and would clutter the /model picker:
//   - embedding / retrieval / reranking
//   - ASR (whisper, parakeet, canary, riva)
//   - TTS / voice / audio
//   - image generation (sdxl, flux, kosmos, stable-diffusion)
//   - safety / guard / reward
//   - vision-only models without a chat tail (note: chat models that *also* have
//     vision keep "-vision-" but match an instruct/chat tail and stay)
//
// Anchored as substrings rather than word-boundaries because NVIDIA ids use
// `/` and `-` inconsistently (e.g. `nvidia/embed-qa-4`, `microsoft/florence-2`).
const NVIDIA_NON_CHAT_PATTERN =
  /(embed|retriever|rerank|reward|nemoguard|content-safety|guard|whisper|parakeet|canary|riva|stable-diffusion|sdxl|flux|kosmos|florence|nvclip|colpali|pho-tabuloud|tts|voice)/i

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
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      mapModel(raw: unknown) {
        const model = raw as {
          id?: string
          active?: boolean
          context_window?: number
        }
        if (!model.id || model.active === false) {
          return null
        }
        if (NVIDIA_NON_CHAT_PATTERN.test(model.id)) {
          return null
        }
        return {
          id: model.id,
          apiName: model.id,
          label: model.id,
          ...(model.context_window
            ? { contextWindow: model.context_window }
            : {}),
        }
      },
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      {
        id: 'nvidia-llama-3.1-nemotron-70b',
        apiName: 'nvidia/llama-3.1-nemotron-70b-instruct',
        label: 'Llama 3.1 Nemotron 70B',
        modelDescriptorId: 'nvidia/llama-3.1-nemotron-70b-instruct',
      },
    ],
  },
  usage: { supported: false },
})

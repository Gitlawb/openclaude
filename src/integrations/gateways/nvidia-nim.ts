import { defineGateway } from '../define.js'

// Positive allowlist for catalog entries returned by
// https://integrate.api.nvidia.com/v1/models. An id must match at least one
// of these chat/instruct/reasoning/code markers to land in the /model picker.
// This is the inverse of the previous exclusion-based filter, which silently
// admitted any non-chat model whose id did not contain one of a fixed set of
// keywords (e.g. `baai/bge-m3`, `google/deplot`, `nvidia/gliner-pii`).
//
// Substring match against the raw id is intentional — NVIDIA mixes `/`, `-`,
// and `_` separators inconsistently, and most chat ids carry an unambiguous
// instruct/reasoning/code marker somewhere in the id.
const NVIDIA_CHAT_MODEL_PATTERN =
  /(instruct|chat(?:qa)?|nemotron|reasoning|reasoner|thinker|thinking|coder|codellama|starcoder|codestral|mathstral|magistral|ministral|devstral|codegemma|qwq|hermes|openchat|magpie|kimi|gpt-?oss|jamba|palmyra|dbrx|seed-oss|yi-large|glm-?\d|minimax-m|mistral-(?:large|medium|small|nemotron|\d)|mixtral|deepseek-(?:v\d|r\d|coder)|llama-?[34]|qwen-?\d|gemma-?\d|phi-?\d|granite-?\d)/i

// Defense-in-depth blacklist: even if an entry slips through the allowlist
// (e.g. an "instruct"-tuned classifier), reject anything that is clearly not
// a generic chat model.
const NVIDIA_NON_CHAT_PATTERN =
  /(embed|retriever|rerank|reward|nemoguard|content-safety|guard|whisper|parakeet|canary|riva|stable-diffusion|sdxl|flux|kosmos|florence|nvclip|colpali|tts|voice|tabular|gliner|video-detector|deplot|ising)/i

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
        if (!NVIDIA_CHAT_MODEL_PATTERN.test(model.id)) {
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

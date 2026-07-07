import { defineGateway } from '../define.js'
import { ZAI_GLM_OPENAI_SHIM } from '../transport/zaiGlmShim.js'

export default defineGateway({
  id: 'gitlawb-opengateway',
  label: 'Gitlawb Opengateway',
  category: 'aggregating',
  defaultBaseUrl: 'https://opengateway.gitlawb.com/v1',
  defaultModel: 'mimo-v2.5-pro',
  supportsModelRouting: true,
  vendorId: 'openai',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENGATEWAY_API_KEY', 'OPENAI_API_KEYS', 'OPENAI_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    // OPENGATEWAY_API_KEY first so users who set both don't get their generic
    // OpenAI key sent to opengateway by accident. OPENAI_API_KEYS / OPENAI_API_KEY kept as
    // fallbacks because existing openclaude configs may already hold generic credentials there.
    credentialEnvVars: ['OPENGATEWAY_API_KEY', 'OPENAI_API_KEYS', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'OPENGATEWAY_API_KEY is required to use Gitlawb Opengateway.\n' +
      'Mint a free API key at https://gitlawb.com/opengateway/keys and set it as OPENGATEWAY_API_KEY (or OPENAI_API_KEYS / OPENAI_API_KEY when OPENAI_BASE_URL points at opengateway).',
    routing: {
      matchBaseUrlHosts: ['opengateway.gitlawb.com', 'opengateway.fly.dev'],
    },
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      // Opengateway expects `Authorization: Bearer ogw_live_...`. Previous
      // `api-key` raw header was a leftover from the direct-Xiaomi era.
      headers: {
        'Accept-Encoding': 'identity',
      },
      defaultAuthHeader: {
        name: 'authorization',
        scheme: 'bearer',
      },
      maxTokensField: 'max_completion_tokens',
      removeBodyFields: ['store', 'stream_options'],
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'gitlawb-opengateway',
    description: 'Gitlawb Opengateway - (API key required, signup at https://gitlawb.com/opengateway/keys)',
    apiKeyEnvVars: ['OPENGATEWAY_API_KEY'],
    label: 'Gitlawb Opengateway',
    name: 'Gitlawb Opengateway',
    vendorId: 'openai',
    modelEnvVars: ['OPENAI_MODEL'],
    baseUrlEnvVars: ['OPENGATEWAY_BASE_URL', 'OPENAI_BASE_URL'],
    fallbackBaseUrl: 'https://opengateway.gitlawb.com/v1',
    fallbackModel: 'mimo-v2.5-pro',
    badge: { text: 'Recommended', color: 'success' },
  },
  catalog: {
    source: 'static',
    models: [
      // Virtual model: the gateway's smart router picks the cheapest model
      // expected to handle the request and escalates on upstream failure
      // (see opengateway/src/routing/). Billed at the serving model's rate;
      // the x-gateway-served-model response header names who answered.
      {
        id: 'opengateway-auto',
        apiName: 'auto',
        label: 'Auto — Smart Routing (via Opengateway)',
        notes: 'Gateway picks the cheapest capable model and escalates on failure',
      },
      {
        id: 'opengateway-mimo-v2.5-pro',
        apiName: 'mimo-v2.5-pro',
        label: 'MiMo V2.5 Pro (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5-pro',
      },
      {
        id: 'opengateway-mimo-v2.5',
        apiName: 'mimo-v2.5',
        label: 'MiMo V2.5 (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5',
      },
      {
        id: 'opengateway-mimo-v2-flash',
        apiName: 'mimo-v2-flash',
        label: 'MiMo V2 Flash (via Opengateway)',
        modelDescriptorId: 'mimo-v2-flash',
      },
      // Non-Xiaomi models reachable through the same gateway endpoint. The
      // gateway routes by model name (see opengateway/src/providers.ts), so
      // the gateway URL stays unchanged; only the apiName the client sends
      // determines the upstream.
      {
        id: 'opengateway-gemini-3.1-flash-lite',
        apiName: 'google/gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash Lite (via Opengateway)',
        modelDescriptorId: 'gemini-3.1-flash-lite',
      },
      {
        id: 'opengateway-minimax-m3',
        apiName: 'minimax/minimax-m3',
        label: 'MiniMax M3 (via Opengateway)',
        modelDescriptorId: 'minimax-m3',
      },
      {
        id: 'opengateway-qwen3.7-max',
        apiName: 'qwen/qwen3.7-max',
        label: 'Qwen 3.7 Max (via Opengateway)',
        modelDescriptorId: 'qwen3.7-max',
      },
      {
        id: 'opengateway-glm-5.2',
        apiName: 'z-ai/glm-5.2',
        label: 'GLM 5.2 (via Opengateway)',
        modelDescriptorId: 'glm-5.2',
        transportOverrides: {
          openaiShim: {
            ...ZAI_GLM_OPENAI_SHIM,
            maxTokensField: 'max_completion_tokens',
            removeBodyFields: ['store', 'stream_options'],
          },
        },
      },
      // OpenRouter :free endpoint — bills $0 and bypasses the gateway credit
      // gate, so it works even with an empty credit balance.
      {
        id: 'opengateway-nemotron-3-ultra-free',
        apiName: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'Nemotron 3 Ultra Free (via Opengateway)',
        modelDescriptorId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        notes: 'Free',
      },
      {
        id: 'opengateway-tencent-hy3',
        apiName: 'tencent/hy3',
        label: 'Tencent HY3 Free (via Opengateway)',
        modelDescriptorId: 'tencent/hy3',
        notes: 'Free',
      },
    ],
  },
  usage: { supported: false },
})

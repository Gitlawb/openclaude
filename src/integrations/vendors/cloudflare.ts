import { defineVendor } from '../define.js'

// Cloudflare Workers AI exposes an OpenAI-compatible endpoint scoped to the
// caller's Cloudflare account id. The base URL contains `<ACCOUNT_ID>` as a
// literal placeholder: users must substitute their account id via the
// `/provider` baseUrl edit (or by setting `OPENAI_BASE_URL` directly) before
// requests will succeed. Same shape `docs/advanced-setup.md` already uses for
// Azure (`https://your-resource.openai.azure.com/...`). See issue #1100.
//
// A first-class AI Gateway integration with `gateway_id` URL templating, and
// dynamic `/models` discovery on the Groq #1143 / mapModel pattern, are clean
// follow-ups left for separate PRs.
export default defineVendor({
  id: 'cloudflare',
  label: 'Cloudflare Workers AI',
  classification: 'openai-compatible',
  defaultBaseUrl:
    'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1',
  defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  requiredEnvVars: ['CLOUDFLARE_API_TOKEN'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['CLOUDFLARE_API_TOKEN'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      maxTokensField: 'max_tokens',
      // Workers AI rejects unknown OpenAI body fields (`store`, persistence
      // flags) — mirror the Mistral / Gemini / Cerebras strip pattern.
      removeBodyFields: ['store'],
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'cloudflare',
    description:
      'Cloudflare Workers AI OpenAI-compatible endpoint. Replace <ACCOUNT_ID> in the base URL with your Cloudflare account id.',
    label: 'Cloudflare Workers AI',
    name: 'Cloudflare Workers AI',
    apiKeyEnvVars: ['CLOUDFLARE_API_TOKEN'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      // `<ACCOUNT_ID>` placeholder won't match a real URL, so rely on host
      // matching to associate user-edited Cloudflare URLs back to this preset.
      matchDefaultBaseUrl: false,
      matchBaseUrlHosts: ['api.cloudflare.com', 'gateway.ai.cloudflare.com'],
    },
    credentialEnvVars: ['CLOUDFLARE_API_TOKEN', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Cloudflare Workers AI auth is required. Set CLOUDFLARE_API_TOKEN or OPENAI_API_KEY.',
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        apiName: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        label: 'Llama 3.3 70B Instruct (FP8 Fast)',
      },
      {
        id: '@cf/meta/llama-3.1-8b-instruct',
        apiName: '@cf/meta/llama-3.1-8b-instruct',
        label: 'Llama 3.1 8B Instruct',
      },
      {
        id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
        apiName: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
        label: 'DeepSeek R1 Distill Qwen 32B',
      },
      {
        id: '@cf/qwen/qwen2.5-coder-32b-instruct',
        apiName: '@cf/qwen/qwen2.5-coder-32b-instruct',
        label: 'Qwen 2.5 Coder 32B Instruct',
      },
    ],
  },
  usage: { supported: false },
})

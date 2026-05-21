import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'nearai',
  label: 'NEAR AI Cloud',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://cloud-api.near.ai/v1',
  defaultModel: 'zai-org/GLM-5.1-FP8',
  requiredEnvVars: ['NEARAI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['NEARAI_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      maxTokensField: 'max_tokens',
      removeBodyFields: ['store', 'reasoning_effort'],
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'nearai',
    description: 'NEAR AI Cloud TEE inference endpoint',
    label: 'NEAR AI Cloud',
    name: 'NEAR AI Cloud',
    apiKeyEnvVars: ['NEARAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['cloud-api.near.ai'],
    },
    credentialEnvVars: ['NEARAI_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'NEAR AI Cloud auth is required. Set NEARAI_API_KEY or OPENAI_API_KEY.',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible' },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      {
        id: 'nearai-glm-5.1-fp8',
        apiName: 'zai-org/GLM-5.1-FP8',
        label: 'GLM 5.1 (TEE)',
        contextWindow: 202752,
      },
      {
        id: 'nearai-qwen3.6-35b-a3b-fp8',
        apiName: 'Qwen/Qwen3.6-35B-A3B-FP8',
        label: 'Qwen 3.6 35B A3B FP8 (TEE)',
        contextWindow: 262144,
      },
      {
        id: 'nearai-qwen3.5-122b-a10b',
        apiName: 'Qwen/Qwen3.5-122B-A10B',
        label: 'Qwen 3.5 122B A10B (TEE)',
        contextWindow: 131072,
      },
      {
        id: 'nearai-qwen3-30b-a3b-instruct',
        apiName: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
        label: 'Qwen3 30B A3B Instruct (TEE)',
        contextWindow: 262144,
      },
      {
        id: 'nearai-qwen3-vl-30b-a3b-instruct',
        apiName: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
        label: 'Qwen3 VL 30B A3B Instruct (TEE)',
        contextWindow: 256000,
        capabilities: {
          supportsVision: true,
        },
      },
      {
        id: 'nearai-gemma-4-31b-it',
        apiName: 'google/gemma-4-31B-it',
        label: 'Gemma 4 31B Instruct (TEE)',
        contextWindow: 262144,
      },
      {
        id: 'nearai-gpt-oss-120b',
        apiName: 'openai/gpt-oss-120b',
        label: 'GPT OSS 120B (TEE)',
        contextWindow: 131000,
      },
    ],
  },
  usage: { supported: false },
})

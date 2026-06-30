import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'nearai',
  label: 'NEAR AI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://cloud-api.near.ai/v1',
  defaultModel: 'anthropic/claude-sonnet-4-6',
  requiredEnvVars: ['NEARAI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['NEARAI_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  preset: {
    id: 'nearai',
    description: 'NEAR AI unified gateway (Claude, GPT, Gemini + TEE models)',
    apiKeyEnvVars: ['NEARAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['cloud-api.near.ai', 'completions.near.ai', '*.completions.near.ai'],
    },
    credentialEnvVars: ['NEARAI_API_KEY'],
    missingCredentialMessage: 'NEARAI_API_KEY is required.',
  },
  catalog: {
    source: 'static',
    models: [
      // ── Anthropic (proxied) ──
      {
        id: 'anthropic/claude-opus-4-8',
        apiName: 'anthropic/claude-opus-4-8',
        label: 'Claude Opus 4.8',
        modelDescriptorId: 'anthropic/claude-opus-4-8',
      },
      {
        id: 'anthropic/claude-opus-4-7',
        apiName: 'anthropic/claude-opus-4-7',
        label: 'Claude Opus 4.7',
        modelDescriptorId: 'anthropic/claude-opus-4-7',
      },
      {
        id: 'anthropic/claude-opus-4-6',
        apiName: 'anthropic/claude-opus-4-6',
        label: 'Claude Opus 4.6',
        modelDescriptorId: 'anthropic/claude-opus-4-6',
      },
      {
        id: 'anthropic/claude-sonnet-4-6',
        apiName: 'anthropic/claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        modelDescriptorId: 'anthropic/claude-sonnet-4-6',
      },
      {
        id: 'anthropic/claude-sonnet-4-5',
        apiName: 'anthropic/claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        modelDescriptorId: 'anthropic/claude-sonnet-4-5',
      },
      {
        id: 'anthropic/claude-haiku-4-5',
        apiName: 'anthropic/claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        modelDescriptorId: 'anthropic/claude-haiku-4-5',
      },
      // ── OpenAI (proxied) ──
      {
        id: 'openai/gpt-5.5',
        apiName: 'openai/gpt-5.5',
        label: 'GPT-5.5',
        modelDescriptorId: 'openai/gpt-5.5',
      },
      {
        id: 'openai/gpt-5.4',
        apiName: 'openai/gpt-5.4',
        label: 'GPT-5.4',
        modelDescriptorId: 'openai/gpt-5.4',
      },
      {
        id: 'openai/gpt-5',
        apiName: 'openai/gpt-5',
        label: 'GPT-5',
        modelDescriptorId: 'openai/gpt-5',
      },
      {
        id: 'openai/gpt-4.1',
        apiName: 'openai/gpt-4.1',
        label: 'GPT-4.1',
        modelDescriptorId: 'openai/gpt-4.1',
      },
      {
        id: 'openai/gpt-4.1-mini',
        apiName: 'openai/gpt-4.1-mini',
        label: 'GPT-4.1 Mini',
        modelDescriptorId: 'openai/gpt-4.1-mini',
      },
      {
        id: 'openai/o3',
        apiName: 'openai/o3',
        label: 'o3',
        modelDescriptorId: 'openai/o3',
      },
      {
        id: 'openai/o4-mini',
        apiName: 'openai/o4-mini',
        label: 'o4-mini',
        modelDescriptorId: 'openai/o4-mini',
      },
      {
        id: 'openai/gpt-oss-120b',
        apiName: 'openai/gpt-oss-120b',
        label: 'GPT-OSS 120B (TEE)',
        modelDescriptorId: 'openai/gpt-oss-120b',
      },
      // ── Google (proxied) ──
      {
        id: 'google/gemini-3.5-flash',
        apiName: 'google/gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        modelDescriptorId: 'google/gemini-3.5-flash',
      },
      {
        id: 'google/gemini-2.5-pro',
        apiName: 'google/gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        modelDescriptorId: 'google/gemini-2.5-pro',
      },
      {
        id: 'google/gemini-2.5-flash',
        apiName: 'google/gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        modelDescriptorId: 'google/gemini-2.5-flash',
      },
      {
        id: 'google/gemma-4-31B-it',
        apiName: 'google/gemma-4-31B-it',
        label: 'Gemma 4 31B (TEE)',
        modelDescriptorId: 'google/gemma-4-31B-it',
      },
      // ── TEE-hosted open models ──
      {
        id: 'zai-org/GLM-5.1-FP8',
        apiName: 'zai-org/GLM-5.1-FP8',
        label: 'GLM 5.1 (TEE)',
        modelDescriptorId: 'zai-org/GLM-5.1-FP8',
      },
      {
        id: 'Qwen/Qwen3.5-122B-A10B',
        apiName: 'Qwen/Qwen3.5-122B-A10B',
        label: 'Qwen3.5 122B (TEE)',
        modelDescriptorId: 'Qwen/Qwen3.5-122B-A10B',
      },
      {
        id: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
        apiName: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
        label: 'Qwen3 30B Instruct (TEE)',
        modelDescriptorId: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
      },
      {
        id: 'moonshotai/kimi-k2.6',
        apiName: 'moonshotai/kimi-k2.6',
        label: 'Kimi K2.6',
        modelDescriptorId: 'moonshotai/kimi-k2.6',
      },
      {
        id: 'qwen/qwen3.7-max',
        apiName: 'qwen/qwen3.7-max',
        label: 'Qwen3.7 Max',
        modelDescriptorId: 'qwen/qwen3.7-max',
      },
    ],
  },
})

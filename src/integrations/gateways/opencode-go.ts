import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'opencode-go',
  label: 'OpenCode Go',
  category: 'aggregating',
  defaultBaseUrl: 'https://opencode.ai/zen/go/v1',
  defaultModel: 'glm-5.1',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENCODE_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
    },
    credentialEnvVars: ['OPENCODE_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'OPENCODE_API_KEY is required. Get your API key from https://opencode.ai',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'opencode-go',
    vendorId: 'openai',
    description: 'OpenCode Go — $10/mo subscription for open models (13 models)',
    apiKeyEnvVars: ['OPENCODE_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  catalog: {
    source: 'static',
    models: [
      // OpenAI-compatible — /zen/go/v1/chat/completions
      { id: 'opencode-go-glm-5.1', apiName: 'glm-5.1', label: 'GLM 5.1', modelDescriptorId: 'opencode-go-glm-5.1' },
      { id: 'opencode-go-glm-5', apiName: 'glm-5', label: 'GLM 5', modelDescriptorId: 'opencode-go-glm-5' },
      { id: 'opencode-go-kimi-k2.5', apiName: 'kimi-k2.5', label: 'Kimi K2.5', modelDescriptorId: 'opencode-go-kimi-k2.5' },
      { id: 'opencode-go-kimi-k2.6', apiName: 'kimi-k2.6', label: 'Kimi K2.6', modelDescriptorId: 'opencode-go-kimi-k2.6' },
      { id: 'opencode-go-deepseek-v4-pro', apiName: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', modelDescriptorId: 'opencode-go-deepseek-v4-pro' },
      { id: 'opencode-go-deepseek-v4-flash', apiName: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', modelDescriptorId: 'opencode-go-deepseek-v4-flash' },
      { id: 'opencode-go-mimo-v2.5', apiName: 'mimo-v2.5', label: 'MiMo V2.5', modelDescriptorId: 'opencode-go-mimo-v2.5' },
      { id: 'opencode-go-mimo-v2.5-pro', apiName: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', modelDescriptorId: 'opencode-go-mimo-v2.5-pro' },
      // Anthropic messages — /zen/go/v1/messages
      { id: 'opencode-go-minimax-m2.7', apiName: 'minimax-m2.7', label: 'MiniMax M2.7', modelDescriptorId: 'opencode-go-minimax-m2.7', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'opencode-go-minimax-m2.5', apiName: 'minimax-m2.5', label: 'MiniMax M2.5', modelDescriptorId: 'opencode-go-minimax-m2.5', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'opencode-go-qwen3.6-plus', apiName: 'qwen3.6-plus', label: 'Qwen3.6 Plus', modelDescriptorId: 'opencode-go-qwen3.6-plus', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'opencode-go-qwen3.5-plus', apiName: 'qwen3.5-plus', label: 'Qwen3.5 Plus', modelDescriptorId: 'opencode-go-qwen3.5-plus', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'opencode-go-minimax-m3', apiName: 'minimax-m3', label: 'MiniMax M3', modelDescriptorId: 'opencode-go-minimax-m3', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
    ],
  },
  usage: { supported: false },
})

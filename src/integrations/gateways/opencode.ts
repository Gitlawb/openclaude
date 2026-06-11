import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'opencode',
  label: 'OpenCode Zen',
  category: 'aggregating',
  defaultBaseUrl: 'https://opencode.ai/zen/v1',
  defaultModel: 'gpt-5.4',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENCODE_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'opencode',
    vendorId: 'openai',
    description: 'OpenCode Zen — pay-as-you-go AI gateway (43 models)',
    apiKeyEnvVars: ['OPENCODE_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
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
  catalog: {
    source: 'static',
    models: [
      // GPT family — /zen/v1/responses
      { id: 'gpt-5.5', apiName: 'gpt-5.5', label: 'GPT 5.5', modelDescriptorId: 'opencode-gpt-5.5', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.5-pro', apiName: 'gpt-5.5-pro', label: 'GPT 5.5 Pro', modelDescriptorId: 'opencode-gpt-5.5-pro', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.4', apiName: 'gpt-5.4', label: 'GPT 5.4', modelDescriptorId: 'opencode-gpt-5.4', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.4-pro', apiName: 'gpt-5.4-pro', label: 'GPT 5.4 Pro', modelDescriptorId: 'opencode-gpt-5.4-pro', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.4-mini', apiName: 'gpt-5.4-mini', label: 'GPT 5.4 Mini', modelDescriptorId: 'opencode-gpt-5.4-mini', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.4-nano', apiName: 'gpt-5.4-nano', label: 'GPT 5.4 Nano', modelDescriptorId: 'opencode-gpt-5.4-nano', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.3-codex', apiName: 'gpt-5.3-codex', label: 'GPT 5.3 Codex', modelDescriptorId: 'opencode-gpt-5.3-codex', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.3-codex-spark', apiName: 'gpt-5.3-codex-spark', label: 'GPT 5.3 Codex Spark', modelDescriptorId: 'opencode-gpt-5.3-codex-spark', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.2', apiName: 'gpt-5.2', label: 'GPT 5.2', modelDescriptorId: 'opencode-gpt-5.2', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.2-codex', apiName: 'gpt-5.2-codex', label: 'GPT 5.2 Codex', modelDescriptorId: 'opencode-gpt-5.2-codex', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.1', apiName: 'gpt-5.1', label: 'GPT 5.1', modelDescriptorId: 'opencode-gpt-5.1', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.1-codex', apiName: 'gpt-5.1-codex', label: 'GPT 5.1 Codex', modelDescriptorId: 'opencode-gpt-5.1-codex', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.1-codex-max', apiName: 'gpt-5.1-codex-max', label: 'GPT 5.1 Codex Max', modelDescriptorId: 'opencode-gpt-5.1-codex-max', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5.1-codex-mini', apiName: 'gpt-5.1-codex-mini', label: 'GPT 5.1 Codex Mini', modelDescriptorId: 'opencode-gpt-5.1-codex-mini', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5', apiName: 'gpt-5', label: 'GPT 5', modelDescriptorId: 'opencode-gpt-5', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5-codex', apiName: 'gpt-5-codex', label: 'GPT 5 Codex', modelDescriptorId: 'opencode-gpt-5-codex', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      { id: 'gpt-5-nano', apiName: 'gpt-5-nano', label: 'GPT 5 Nano', modelDescriptorId: 'opencode-gpt-5-nano', transportOverrides: { openaiShim: { endpointPath: '/responses' } } },
      // Claude family — /zen/v1/messages
      { id: 'claude-opus-4-7', apiName: 'claude-opus-4-7', label: 'Claude Opus 4.7', modelDescriptorId: 'opencode-claude-opus-4-7', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-opus-4-8', apiName: 'claude-opus-4-8', label: 'Claude Opus 4.8', modelDescriptorId: 'opencode-claude-opus-4-8', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-opus-4-6', apiName: 'claude-opus-4-6', label: 'Claude Opus 4.6', modelDescriptorId: 'opencode-claude-opus-4-6', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-opus-4-5', apiName: 'claude-opus-4-5', label: 'Claude Opus 4.5', modelDescriptorId: 'opencode-claude-opus-4-5', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-opus-4-1', apiName: 'claude-opus-4-1', label: 'Claude Opus 4.1', modelDescriptorId: 'opencode-claude-opus-4-1', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-sonnet-4-6', apiName: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', modelDescriptorId: 'opencode-claude-sonnet-4-6', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-sonnet-4-5', apiName: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', modelDescriptorId: 'opencode-claude-sonnet-4-5', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-sonnet-4', apiName: 'claude-sonnet-4', label: 'Claude Sonnet 4', modelDescriptorId: 'opencode-claude-sonnet-4', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-haiku-4-5', apiName: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', modelDescriptorId: 'opencode-claude-haiku-4-5', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'claude-3-5-haiku', apiName: 'claude-3-5-haiku', label: 'Claude Haiku 3.5', modelDescriptorId: 'opencode-claude-3-5-haiku', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      // Gemini family — /zen/v1/models/<id>
      { id: 'gemini-3.5-flash', apiName: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', modelDescriptorId: 'opencode-gemini-3.5-flash', transportOverrides: { openaiShim: { endpointPath: '/models/gemini-3.5-flash' } } },
      { id: 'gemini-3.1-pro', apiName: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', modelDescriptorId: 'opencode-gemini-3.1-pro', transportOverrides: { openaiShim: { endpointPath: '/models/gemini-3.1-pro' } } },
      { id: 'gemini-3-flash', apiName: 'gemini-3-flash', label: 'Gemini 3 Flash', modelDescriptorId: 'opencode-gemini-3-flash', transportOverrides: { openaiShim: { endpointPath: '/models/gemini-3-flash' } } },
      // Qwen — /zen/v1/messages
      { id: 'qwen3.6-plus', apiName: 'qwen3.6-plus', label: 'Qwen3.6 Plus', modelDescriptorId: 'opencode-qwen3.6-plus', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      { id: 'qwen3.5-plus', apiName: 'qwen3.5-plus', label: 'Qwen3.5 Plus', modelDescriptorId: 'opencode-qwen3.5-plus', transportOverrides: { openaiShim: { endpointPath: '/messages' } } },
      // OpenAI-compatible — /zen/v1/chat/completions (default, no override needed)
      { id: 'minimax-m2.7', apiName: 'minimax-m2.7', label: 'MiniMax M2.7', modelDescriptorId: 'opencode-minimax-m2.7' },
      { id: 'minimax-m2.5', apiName: 'minimax-m2.5', label: 'MiniMax M2.5', modelDescriptorId: 'opencode-minimax-m2.5' },
      { id: 'glm-5.1', apiName: 'glm-5.1', label: 'GLM 5.1', modelDescriptorId: 'opencode-glm-5.1' },
      { id: 'glm-5', apiName: 'glm-5', label: 'GLM 5', modelDescriptorId: 'opencode-glm-5' },
      { id: 'kimi-k2.5', apiName: 'kimi-k2.5', label: 'Kimi K2.5', modelDescriptorId: 'opencode-kimi-k2.5' },
      { id: 'kimi-k2.6', apiName: 'kimi-k2.6', label: 'Kimi K2.6', modelDescriptorId: 'opencode-kimi-k2.6' },
      { id: 'grok-build-0.1', apiName: 'grok-build-0.1', label: 'Grok Build 0.1', modelDescriptorId: 'opencode-grok-build-0.1' },
      { id: 'big-pickle', apiName: 'big-pickle', label: 'Big Pickle', modelDescriptorId: 'opencode-big-pickle' },
      { id: 'deepseek-v4-flash-free', apiName: 'deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free', modelDescriptorId: 'opencode-deepseek-v4-flash-free' },
      { id: 'nemotron-3-super-free', apiName: 'nemotron-3-super-free', label: 'Nemotron 3 Super Free', modelDescriptorId: 'opencode-nemotron-3-super-free' },
      { id: 'mimo-v2.5-free', apiName: 'mimo-v2.5-free', label: 'MiMo V2.5 Free', modelDescriptorId: 'opencode-mimo-v2.5-free' },
    ],
  },
  usage: { supported: false },
})

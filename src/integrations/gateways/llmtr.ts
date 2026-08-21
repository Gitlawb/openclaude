import { defineGateway } from '../define.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getTrimmedString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : undefined
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : undefined
}

function hasStringValue(value: unknown, expected: string): boolean {
  return (
    Array.isArray(value) &&
    value.some(item => typeof item === 'string' && item === expected)
  )
}

/**
 * LLMTR's /models endpoint describes every operation served by the gateway,
 * including Responses, embeddings, images, audio, video, and reranking. The
 * OpenClaude route is deliberately a chat-completions coding-agent transport,
 * so discovery must keep only models that can serve both that endpoint and the
 * tool calls required by an agent session.
 */
function mapLlmtrModel(raw: unknown) {
  if (!isRecord(raw)) {
    return null
  }

  const id = getTrimmedString(raw, 'id')
  if (
    !id ||
    !hasStringValue(raw.supported_operations, 'CHAT_COMPLETIONS') ||
    !hasStringValue(raw.supported_endpoints, '/v1/chat/completions') ||
    !hasStringValue(raw.supported_parameters, 'tools')
  ) {
    return null
  }

  const topProvider = isRecord(raw.top_provider) ? raw.top_provider : null
  const architecture = isRecord(raw.architecture) ? raw.architecture : null
  const reasoning = isRecord(raw.reasoning) ? raw.reasoning : null
  const contextWindow =
    getPositiveInteger(raw.context_length) ??
    getPositiveInteger(topProvider?.context_length)
  const maxOutputTokens = getPositiveInteger(
    topProvider?.max_completion_tokens,
  )
  const label = getTrimmedString(raw, 'name') || id

  return {
    id,
    apiName: id,
    label,
    capabilities: {
      supportsFunctionCalling: true,
      supportsVision: hasStringValue(architecture?.input_modalities, 'image'),
      supportsReasoning:
        reasoning !== null ||
        hasStringValue(raw.supported_parameters, 'reasoning') ||
        hasStringValue(raw.supported_parameters, 'reasoning_effort'),
    },
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  }
}

export default defineGateway({
  id: 'llmtr',
  label: 'LLMTR',
  category: 'aggregating',
  defaultBaseUrl: 'https://llmtr.com/v1',
  // LLMTR is primarily a multi-vendor gateway, so the default is a global
  // passthrough route rather than one of the Turkey-hosted models — it is the
  // broadly useful choice for a fresh setup. Turkey-hosted `llmtr/*` models
  // stay one selection away in the picker.
  defaultModel: 'anthropic/claude-sonnet-4.6',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['LLMTR_API_KEY'],
    // Dedicated key only: never fall back to OPENAI_API_KEY, which would send a
    // generic OpenAI credential to llmtr.com.
    dedicatedCredentialsOnly: true,
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      requiredApiFormat: 'chat_completions',
      // LLMTR's Chat Completions API accepts the standard max_tokens field and
      // authenticates only with Authorization: Bearer <key>.
      maxTokensField: 'max_tokens',
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'llmtr',
    description: 'LLMTR OpenAI-compatible multi-vendor gateway (hosted in Turkey)',
    apiKeyEnvVars: ['LLMTR_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['llmtr.com'],
    },
    credentialEnvVars: ['LLMTR_API_KEY'],
    missingCredentialMessage:
      'Set LLMTR_API_KEY for the LLMTR provider. Get a key at https://llmtr.com.',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      // The catalog is public and identical for every credential. Avoid
      // transmitting secrets or partitioning its cache by key.
      requiresAuth: false,
      mapModel: mapLlmtrModel,
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    // Seed entries only — LLMTR serves ~236 routes and `source: 'hybrid'`
    // discovery fills in the rest from /v1/models. Limits mirror
    // https://llmtr.com/api/models.
    //
    // `aliases` carry the descriptor id wherever it differs from the wire name,
    // because profileSupportsModel matches on apiName / catalog id / aliases —
    // not on modelDescriptorId. Without them a `/model` pick made by descriptor
    // id would not survive a relaunch (Atlas Cloud / Hicap parity).
    models: [
      // Global passthrough routes. These are the bulk of the gateway (227 of
      // 236 routes today) and cover the major vendors.
      { id: 'llmtr-claude-sonnet-4.6', apiName: 'anthropic/claude-sonnet-4.6', aliases: ['claude-sonnet-4-6'], label: 'Claude Sonnet 4.6', modelDescriptorId: 'claude-sonnet-4-6', contextWindow: 1_000_000, maxOutputTokens: 128_000 },
      { id: 'llmtr-claude-haiku-4.5', apiName: 'anthropic/claude-haiku-4.5', aliases: ['claude-haiku-4-5'], label: 'Claude Haiku 4.5', modelDescriptorId: 'claude-haiku-4-5', contextWindow: 200_000, maxOutputTokens: 64_000 },
      { id: 'llmtr-gpt-5.4', apiName: 'openai/gpt-5.4', aliases: ['gpt-5.4'], label: 'GPT-5.4', modelDescriptorId: 'gpt-5.4', contextWindow: 272_000, maxOutputTokens: 128_000 },
      { id: 'llmtr-gemini-3.1-pro-preview', apiName: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', modelDescriptorId: 'google/gemini-3.1-pro-preview', contextWindow: 1_048_576, maxOutputTokens: 65_536 },
      { id: 'llmtr-deepseek-v4-pro', apiName: 'deepseek/deepseek-v4-pro', aliases: ['deepseek-v4-pro'], label: 'DeepSeek V4 Pro', modelDescriptorId: 'deepseek-v4-pro', contextWindow: 1_000_000, maxOutputTokens: 393_216 },
      { id: 'llmtr-glm-5.2', apiName: 'zai/glm-5.2', aliases: ['glm-5.2'], label: 'GLM-5.2', modelDescriptorId: 'glm-5.2', contextWindow: 1_000_000, maxOutputTokens: 131_072 },
      { id: 'llmtr-minimax-m3', apiName: 'minimax/minimax-m3', aliases: ['minimax-m3'], label: 'MiniMax M3', modelDescriptorId: 'minimax-m3', contextWindow: 1_000_000, maxOutputTokens: 524_288 },
      { id: 'llmtr-kimi-k2.7-code', apiName: 'moonshot/kimi-k2.7-code', aliases: ['kimi-k2.7-code'], label: 'Kimi K2.7 Code', modelDescriptorId: 'kimi-k2.7-code', contextWindow: 262_144, maxOutputTokens: 262_144 },
      { id: 'llmtr-qwen3.7-max', apiName: 'qwen/qwen3.7-max', aliases: ['qwen3.7-max'], label: 'Qwen3.7-Max', modelDescriptorId: 'qwen3.7-max', contextWindow: 256_000, maxOutputTokens: 131_072 },
      { id: 'llmtr-mistral-large', apiName: 'mistral/mistral-large-latest', aliases: ['mistral-large-latest'], label: 'Mistral Large 3', modelDescriptorId: 'mistral-large-latest', contextWindow: 256_000, maxOutputTokens: 256_000 },
      // Turkey-hosted models run on LLMTR's own infrastructure. Fewer routes,
      // but they are what distinguishes this gateway from a generic proxy.
      { id: 'llmtr-gemma-4', apiName: 'llmtr/gemma-4', label: 'Gemma 4 (Turkey-hosted)', modelDescriptorId: 'llmtr/gemma-4', contextWindow: 131_072, maxOutputTokens: 131_072 },
      { id: 'llmtr-muse-glimmer-30b-tr', apiName: 'llmtr/muse-glimmer-30b-tr', label: 'Muse Glimmer 30B (Turkey-hosted)', modelDescriptorId: 'llmtr/muse-glimmer-30b-tr', contextWindow: 131_072, maxOutputTokens: 131_072 },
    ],
  },
  usage: { supported: false },
})

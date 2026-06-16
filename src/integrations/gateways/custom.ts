import { defineGateway } from '../define.js'

function getContextWindow(value: unknown): number | undefined {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  ) {
    return value
  }
  return undefined
}

function getModelInfo(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const modelInfo = (raw as { model_info?: unknown }).model_info
  return modelInfo && typeof modelInfo === 'object' && !Array.isArray(modelInfo)
    ? (modelInfo as Record<string, unknown>)
    : undefined
}

export default defineGateway({
  id: 'custom',
  label: 'Custom OpenAI-compatible',
  category: 'hosted',
  defaultModel: 'llama3.1:8b',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'api-key',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: true,
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'custom',
    description: 'Any OpenAI-compatible provider',
    label: 'Custom',
    name: 'Custom OpenAI-compatible',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    baseUrlEnvVars: ['OPENAI_BASE_URL', 'OPENAI_API_BASE'],
    modelEnvVars: ['OPENAI_MODEL'],
    fallbackBaseUrl: 'http://localhost:11434/v1',
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      mapModel(raw: unknown) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return null
        }

        const model = raw as Record<string, unknown>
        const modelId = typeof model.id === 'string' ? model.id.trim() : ''
        if (!modelId) {
          return null
        }
        const modelInfo = getModelInfo(raw)
        const contextWindow =
          getContextWindow(model.context_length) ??
          getContextWindow(model.context_window) ??
          getContextWindow(model.max_model_len) ??
          getContextWindow(model.max_input_tokens) ??
          getContextWindow(modelInfo?.context_length) ??
          getContextWindow(modelInfo?.context_window) ??
          getContextWindow(modelInfo?.max_model_len) ??
          getContextWindow(modelInfo?.max_input_tokens)
        return {
          id: modelId,
          apiName: modelId,
          label: modelId,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        }
      },
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'startup',
    allowManualRefresh: true,
    models: [],
  },
  usage: { supported: false },
})

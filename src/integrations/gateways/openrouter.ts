import { defineGateway } from '../define.js'
import type { ModelCatalogEntry } from '../descriptors.js'

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

function firstPositiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return undefined
}

function isKnownNonCodingModelId(id: string): boolean {
  return /(audio|dall-e|deep-research|embedding|image|moderation|realtime|rerank|sora|speech|transcribe|translate|tts|whisper)/i.test(
    id,
  )
}

function looksLikeCodingModelId(id: string): boolean {
  if (!id || isKnownNonCodingModelId(id)) {
    return false
  }
  return /(gpt|claude|sonnet|opus|haiku|gemini|gemma|llama|qwen|deepseek|kimi|moonshot|minimax|mistral|codestral|devstral|magistral|ministral|grok|glm|command|nemotron|mixtral|coder|code|chat|instruct|reasoner|reasoning|mimo|hy3|tencent|maverick|scout|bankr|o[1-5](?:-|$))/i.test(
    id,
  )
}

function supportsTools(raw: Record<string, unknown>): boolean {
  const params = raw.supported_parameters
  return Array.isArray(params) && params.some(value => value === 'tools')
}

function supportsReasoning(raw: Record<string, unknown>): boolean {
  const params = raw.supported_parameters
  if (
    Array.isArray(params) &&
    params.some(
      value =>
        value === 'reasoning' ||
        value === 'reasoning_effort' ||
        value === 'include_reasoning',
    )
  ) {
    return true
  }
  const reasoning = raw.reasoning
  if (reasoning === true) {
    return true
  }
  if (isRecord(reasoning)) {
    return (
      reasoning.mandatory === true ||
      reasoning.default_enabled === true ||
      (Array.isArray(reasoning.supported_efforts) &&
        reasoning.supported_efforts.length > 0)
    )
  }
  return false
}

function isFreeModel(id: string, raw: Record<string, unknown>): boolean {
  return (
    id.toLowerCase().endsWith(':free') ||
    raw.free === true ||
    raw.is_free === true
  )
}

/**
 * Map OpenRouter's public GET /api/v1/models payload into a catalog entry.
 * Keeps coding-capable chat models and drops embeddings/image/audio routes.
 */
export function mapOpenRouterModel(raw: unknown): ModelCatalogEntry | null {
  if (!isRecord(raw)) {
    return null
  }

  const id = getTrimmedString(raw, 'id')
  if (!id || isKnownNonCodingModelId(id)) {
    return null
  }

  const architecture = isRecord(raw.architecture) ? raw.architecture : null
  const outputModalities = Array.isArray(architecture?.output_modalities)
    ? architecture.output_modalities.filter(
        (value): value is string => typeof value === 'string',
      )
    : []
  if (outputModalities.length > 0 && !outputModalities.includes('text')) {
    return null
  }

  const toolCall = supportsTools(raw)
  const reasoning = supportsReasoning(raw)
  if (!toolCall && !reasoning && !looksLikeCodingModelId(id)) {
    return null
  }

  const name = getTrimmedString(raw, 'name')
  const free = isFreeModel(id, raw)
  let label = name || id
  if (free && !label.toLowerCase().includes('free')) {
    label = `${label} (free)`
  }

  const contextWindow = firstPositiveNumber(
    raw.context_length,
    raw.max_context_length,
    raw.context_window,
    raw.contextWindow,
  )

  return {
    id,
    apiName: id,
    label,
    ...(contextWindow ? { contextWindow } : {}),
    ...(free ? { notes: 'Free' } : {}),
    ...(toolCall || reasoning
      ? {
          capabilities: {
            ...(toolCall ? { supportsFunctionCalling: true } : {}),
            ...(reasoning ? { supportsReasoning: true } : {}),
          },
        }
      : {}),
  }
}

export default defineGateway({
  id: 'openrouter',
  label: 'OpenRouter',
  category: 'aggregating',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-5-mini',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENROUTER_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'openrouter',
    description: 'OpenRouter OpenAI-compatible endpoint',
    apiKeyEnvVars: ['OPENROUTER_API_KEY'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      // Public model list works without a key (same posture as cairn-code).
      requiresAuth: false,
      mapModel: mapOpenRouterModel,
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      { id: 'openrouter-gpt-5-mini', apiName: 'openai/gpt-5-mini', label: 'GPT-5 Mini (via OpenRouter)', modelDescriptorId: 'gpt-5-mini' },
      { id: 'openrouter-grok-4.6', apiName: 'x-ai/grok-4.6', label: 'Grok 4.6 (via OpenRouter)', modelDescriptorId: 'grok-4.6' },
      { id: 'openrouter-grok-4.5', apiName: 'x-ai/grok-4.5', label: 'Grok 4.5 (via OpenRouter)', modelDescriptorId: 'grok-4.5' },
    ],
  },
  usage: { supported: false },
})

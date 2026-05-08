import {
  getDefaultModelForProvider,
  getModelMetadata,
} from '../../integrations/modelCatalog/catalog.js'
import type { ModelDefaultRole } from '../../integrations/modelCatalog/types.js'
import type { ModelName } from './model.js'
import type { LegacyAPIProvider } from './providers.js'

// Transitional compatibility table keyed by the legacy provider categories
// returned from getAPIProvider(). The model strings are derived from
// src/integrations/modelCatalog/providers/*.json so provider/model data has a
// single source of truth.
export type LegacyProviderModelConfig = Record<LegacyAPIProvider, ModelName>

// Backward-compatible alias for existing imports.
export type ModelConfig = LegacyProviderModelConfig

const LEGACY_MODEL_CATALOG_IDS = {
  haiku35: 'claude-3-5-haiku',
  haiku45: 'claude-haiku-4-5',
  sonnet35: 'claude-3-5-sonnet',
  sonnet37: 'claude-3-7-sonnet',
  sonnet40: 'claude-sonnet-4',
  sonnet45: 'claude-sonnet-4-5',
  sonnet46: 'claude-sonnet-4-6',
  opus40: 'claude-opus-4',
  opus41: 'claude-opus-4-1',
  opus45: 'claude-opus-4-5',
  opus46: 'claude-opus-4-6',
  opus47: 'claude-opus-4-7',
} as const

export type ModelKey = keyof typeof LEGACY_MODEL_CATALOG_IDS

const MODEL_KEY_DEFAULT_ROLE: Record<ModelKey, ModelDefaultRole> = {
  haiku35: 'haiku',
  haiku45: 'haiku',
  sonnet35: 'sonnet',
  sonnet37: 'sonnet',
  sonnet40: 'sonnet',
  sonnet45: 'sonnet',
  sonnet46: 'sonnet',
  opus40: 'opus',
  opus41: 'opus',
  opus45: 'opus',
  opus46: 'opus',
  opus47: 'opus',
}

const LEGACY_PROVIDER_CATALOG_IDS: Record<LegacyAPIProvider, string> = {
  firstParty: 'anthropic',
  bedrock: 'bedrock',
  vertex: 'vertex',
  foundry: 'foundry',
  openai: 'openai',
  gemini: 'gemini',
  github: 'github-copilot',
  codex: 'codex',
  'nvidia-nim': 'nvidia-nim',
  minimax: 'minimax',
  mistral: 'mistral',
  xai: 'xai',
}

function requireAnthropicModel(modelId: string) {
  const metadata = getModelMetadata(modelId, 'anthropic')
  if (!metadata) {
    throw new Error(`Missing Anthropic model catalog entry "${modelId}"`)
  }
  return metadata
}

function getProviderSpecificCatalogModel(
  provider: LegacyAPIProvider,
  modelId: string,
): string | undefined {
  const catalogProviderId = LEGACY_PROVIDER_CATALOG_IDS[provider]
  const providerModelId = `${catalogProviderId}-${modelId}`
  return (
    getModelMetadata(providerModelId, catalogProviderId)?.apiName ??
    getModelMetadata(modelId, catalogProviderId)?.apiName
  )
}

function getEquivalentProviderModel(
  key: ModelKey,
  provider: LegacyAPIProvider,
): string {
  const modelId = LEGACY_MODEL_CATALOG_IDS[key]
  const anthropicModel = requireAnthropicModel(modelId)

  if (provider === 'firstParty') {
    return anthropicModel.apiName
  }

  const mappedModel = anthropicModel.compatibility?.providerModelMap?.[provider]
  if (mappedModel) {
    return mappedModel
  }

  const providerSpecificModel = getProviderSpecificCatalogModel(provider, modelId)
  if (providerSpecificModel) {
    return providerSpecificModel
  }

  const catalogProviderId = LEGACY_PROVIDER_CATALOG_IDS[provider]
  return (
    getDefaultModelForProvider(catalogProviderId, MODEL_KEY_DEFAULT_ROLE[key]) ??
    getDefaultModelForProvider(catalogProviderId) ??
    anthropicModel.apiName
  )
}

function buildLegacyProviderModelConfig(key: ModelKey): LegacyProviderModelConfig {
  return {
    firstParty: getEquivalentProviderModel(key, 'firstParty'),
    bedrock: getEquivalentProviderModel(key, 'bedrock'),
    vertex: getEquivalentProviderModel(key, 'vertex'),
    foundry: getEquivalentProviderModel(key, 'foundry'),
    openai: getEquivalentProviderModel(key, 'openai'),
    gemini: getEquivalentProviderModel(key, 'gemini'),
    github: getEquivalentProviderModel(key, 'github'),
    codex: getEquivalentProviderModel(key, 'codex'),
    'nvidia-nim': getEquivalentProviderModel(key, 'nvidia-nim'),
    minimax: getEquivalentProviderModel(key, 'minimax'),
    mistral: getEquivalentProviderModel(key, 'mistral'),
    xai: getEquivalentProviderModel(key, 'xai'),
  }
}

export const LEGACY_PROVIDER_MODEL_CONFIGS = Object.fromEntries(
  (Object.keys(LEGACY_MODEL_CATALOG_IDS) as ModelKey[]).map(key => [
    key,
    buildLegacyProviderModelConfig(key),
  ]),
) as Record<ModelKey, LegacyProviderModelConfig>

// Backward-compatible alias for existing imports.
export const ALL_MODEL_CONFIGS = LEGACY_PROVIDER_MODEL_CONFIGS

export const CLAUDE_3_5_HAIKU_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.haiku35
export const CLAUDE_HAIKU_4_5_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.haiku45
export const CLAUDE_3_5_V2_SONNET_CONFIG =
  LEGACY_PROVIDER_MODEL_CONFIGS.sonnet35
export const CLAUDE_3_7_SONNET_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.sonnet37
export const CLAUDE_SONNET_4_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.sonnet40
export const CLAUDE_SONNET_4_5_CONFIG =
  LEGACY_PROVIDER_MODEL_CONFIGS.sonnet45
export const CLAUDE_SONNET_4_6_CONFIG =
  LEGACY_PROVIDER_MODEL_CONFIGS.sonnet46
export const CLAUDE_OPUS_4_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.opus40
export const CLAUDE_OPUS_4_1_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.opus41
export const CLAUDE_OPUS_4_5_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.opus45
export const CLAUDE_OPUS_4_6_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.opus46
export const CLAUDE_OPUS_4_7_CONFIG = LEGACY_PROVIDER_MODEL_CONFIGS.opus47

export const OPENAI_MODEL_DEFAULTS = {
  opus:
    getDefaultModelForProvider('openai', 'opus') ??
    getEquivalentProviderModel('opus46', 'openai'),
  sonnet:
    getDefaultModelForProvider('openai', 'sonnet') ??
    getEquivalentProviderModel('sonnet46', 'openai'),
  haiku:
    getDefaultModelForProvider('openai', 'haiku') ??
    getEquivalentProviderModel('haiku45', 'openai'),
} as const

export const GEMINI_MODEL_DEFAULTS = {
  opus:
    getDefaultModelForProvider('gemini', 'opus') ??
    getEquivalentProviderModel('opus46', 'gemini'),
  sonnet:
    getDefaultModelForProvider('gemini', 'sonnet') ??
    getEquivalentProviderModel('sonnet46', 'gemini'),
  haiku:
    getDefaultModelForProvider('gemini', 'haiku') ??
    getEquivalentProviderModel('haiku45', 'gemini'),
} as const

/** Union of canonical first-party model IDs accepted in modelOverrides. */
export type CanonicalModelId = string

/** Runtime list of canonical model IDs - used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = (Object.keys(
  LEGACY_PROVIDER_MODEL_CONFIGS,
) as ModelKey[]).map(
  key => LEGACY_PROVIDER_MODEL_CONFIGS[key].firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID -> internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.keys(LEGACY_PROVIDER_MODEL_CONFIGS) as ModelKey[]).map(key => [
      LEGACY_PROVIDER_MODEL_CONFIGS[key].firstParty,
      key,
    ]),
  )

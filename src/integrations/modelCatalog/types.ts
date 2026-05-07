import type { OpenAIShimTransportConfig } from '../descriptors.js'

export type CatalogProtocol =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-native'
  | 'alibaba-compatible'
  | 'models-list'

export type ModelClassification = 'chat' | 'reasoning' | 'vision' | 'coding'
export type ModelStatus = 'active' | 'preview' | 'deprecated' | 'hidden'
export type ModelTier =
  | 'ant'
  | 'max'
  | 'teamPremium'
  | 'pro'
  | 'payg1p'
  | 'payg3p'
  | 'thirdParty'

export type ModelDefaultRole =
  | 'main'
  | 'opus'
  | 'sonnet'
  | 'haiku'
  | 'smallFast'
  | 'advisor'

export type EffortScheme = 'anthropic' | 'openai' | 'numeric'
export type DiscoveryParser = 'openai-models-list' | 'ollama-tags' | 'custom'
export type DiscoveryRefreshMode =
  | 'manual'
  | 'on-open'
  | 'background-if-stale'
  | 'startup'

export type DurationString = `${number}m` | `${number}h` | `${number}d`

export type ModelOutputTokenLimits = {
  default: number
  upperLimit: number
}

export type ModelLimits = {
  contextWindow?: number
  maxInputTokens?: number
  maxOutputTokens?: ModelOutputTokenLimits
  compactMaxOutputTokens?: number
}

export type ModelCapabilities = {
  vision?: boolean
  streaming?: boolean
  functionCalling?: boolean
  jsonMode?: boolean
  structuredOutputs?: boolean
  reasoning?: boolean
  thinking?: boolean
  adaptiveThinking?: boolean
  interleavedThinking?: boolean
  contextManagement?: boolean
  promptCaching?: boolean
  preciseTokenCount?: boolean
  webSearch?: boolean
  advisor?: boolean
  advisorTarget?: boolean
  autoMode?: boolean
  fastMode?: boolean
}

export type ModelEffort = {
  scheme: EffortScheme
  supported: boolean
  levels: string[]
  defaultLevel?: string
  maxLevel?: string
  clampUnsupportedMaxTo?: string
}

export type ModelPricing = {
  input: number
  output: number
  cacheWrite?: number
  cacheRead?: number
  webSearch?: number
  variants?: Record<string, Partial<Omit<ModelPricing, 'variants'>>>
}

export type ModelVisibility = {
  tiers?: ModelTier[]
  hidden?: boolean
  order?: number
  defaultFor?: ModelDefaultRole[]
}

export type ModelUiMetadata = {
  pickerLabel?: string
  pickerDescription?: string
  descriptionForModel?: string
  marketingName?: string
  upgradeHintFamily?: string
}

export type ModelContextUpgrade = {
  alias: string
  label: string
  maxContext: number
  multiplier?: number
  accessPolicy?: 'extraUsage' | 'always' | 'antOnly'
}

export type ModelCompatibility = {
  legacyIds?: string[]
  canonicalPattern?: string
  providerModelMap?: Record<string, string>
  fallbackSuggestion?: string
  migrationAliases?: string[]
}

export type CatalogRequestConfig = Partial<
  Pick<
    OpenAIShimTransportConfig,
    | 'maxTokensField'
    | 'preserveReasoningContent'
    | 'requireReasoningContentOnAssistantMessages'
    | 'reasoningContentFallback'
    | 'thinkingRequestFormat'
    | 'removeBodyFields'
  >
> & {
  reasoningField?: 'reasoning_effort' | 'thinking'
}

export type CatalogEndpoint = {
  path: string
  method?: 'GET' | 'POST'
  protocol: CatalogProtocol
  streaming?: boolean
  request?: CatalogRequestConfig
}

export type ProviderDiscoveryConfig = {
  endpoint: string
  parser: DiscoveryParser
  cacheTtl?: DurationString
  refreshMode?: DiscoveryRefreshMode
}

export type ProviderCatalogDefaults = {
  endpoint?: string
  limits?: ModelLimits
  capabilities?: ModelCapabilities
  effort?: ModelEffort
  pricing?: ModelPricing
  visibility?: ModelVisibility
  ui?: ModelUiMetadata
  request?: CatalogRequestConfig
}

export type ModelCatalogEntry = {
  label: string
  apiName?: string
  canonicalModelId?: string
  aliases?: string[]
  family?: string
  classification?: ModelClassification[]
  status?: ModelStatus
  endpoint?: string
  apiNamePrefix?: string
  fallbackEndpoint?: string
  regionPreference?: string[]
  extends?: string[]
  limits?: ModelLimits
  capabilities?: ModelCapabilities
  effort?: ModelEffort
  pricing?: ModelPricing
  visibility?: ModelVisibility
  ui?: ModelUiMetadata
  contextUpgrade?: ModelContextUpgrade
  compatibility?: ModelCompatibility
  request?: CatalogRequestConfig
}

type CatalogTemplateValue<T> = T extends unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: CatalogTemplateValue<T[K]> }
    : T

export type ModelCatalogTemplate = CatalogTemplateValue<ModelCatalogEntry> &
  Record<string, unknown>

export type ProviderCatalog = {
  schemaVersion: 1
  provider: string
  label: string
  baseUrl?: string
  endpoints: Record<string, CatalogEndpoint>
  defaults?: ProviderCatalogDefaults
  templates?: Record<string, ModelCatalogTemplate>
  models: Record<string, ModelCatalogEntry>
  discovery?: ProviderDiscoveryConfig
}

export type NormalizedModelMetadata = ModelCatalogEntry & {
  provider: string
  id: string
  apiName: string
  endpoint: string
}

export type ResolvedModelEndpoint = CatalogEndpoint & {
  provider: string
  endpointId: string
  baseUrl?: string
  url?: string
}
